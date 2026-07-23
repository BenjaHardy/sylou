import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// delete-account: permanently erases the authenticated caller's account.
//
// Order of operations (deliberate):
//   1. Purge every storage object under imports/<user-id>/ — storage never
//      cascades from DB rows, and purging first keeps every failure mode
//      retryable: if the purge errors, nothing has been deleted yet and the
//      user simply tries again. (The reverse order could orphan files with
//      no owner and no UI able to retry — the bug class this function
//      exists to close.)
//   2. auth.admin.deleteUser — the DB schema cascades from auth.users:
//      profiles → projects → every child table (writing, chat threads and
//      messages, FLOW reports, post-its, bookmarks, imported_documents,
//      token_usage). Shared report links die with their flow_reports rows.
//
// A storage purge that fails part-way leaves the account intact; the retry
// re-lists whatever is left, so the purge is idempotent.
//
// This function reads no request body and can only ever delete the caller
// identified by the verified JWT — there is no way to target another user.
//
// No rate limiting by design: per project policy (CLAUDE.md §5) throttling
// is deferred to platform primitives (Supabase auth rate limits, WAF), and
// the endpoint is self-limiting — the first success deletes the account and
// every subsequent call fails auth.

import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("POST, OPTIONS");

const IMPORTS_BUCKET = "imports";
const LIST_PAGE_SIZE = 1000; // storage list() defaults to 100 — paginate explicitly
const REMOVE_CHUNK_SIZE = 100; // stay well under the bulk-delete cap

type StorageEntry = { name: string; id: string | null };

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // --- Auth: identify the caller from their JWT ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client (caller's JWT) for identity only. getUser() is a
    // server-side validation round-trip — a revoked or expired session
    // cannot delete anything.
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Service-role client for the storage purge + admin delete.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // List every entry at one level of the bucket, fully paginated. Storage
    // list() is per-level, not recursive: folder prefixes come back with a
    // null id, files with a real one. (Closures over `admin` — its generic
    // instance type doesn't cross function boundaries cleanly.)
    const listLevel = async (prefix: string): Promise<StorageEntry[]> => {
      const entries: StorageEntry[] = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { data, error } = await admin.storage
          .from(IMPORTS_BUCKET)
          .list(prefix, { limit: LIST_PAGE_SIZE, offset });
        if (error) {
          throw new Error(`storage list failed at "${prefix}": ${error.message}`);
        }
        for (const e of data ?? []) entries.push({ name: e.name, id: e.id ?? null });
        if (!data || data.length < LIST_PAGE_SIZE) break;
      }
      return entries;
    };

    // Collect every file path under imports/<userId>/. Uploads only ever
    // create <userId>/<projectId>/<fileName> (useImportedDocuments), so the
    // walk is two levels; anything deeper is unexpected and fails the purge
    // closed rather than silently leaving files behind.
    const collectUserFilePaths = async (userId: string): Promise<string[]> => {
      const paths: string[] = [];
      const top = await listLevel(userId);
      const folders: string[] = [];
      for (const entry of top) {
        if (entry.id === null) folders.push(entry.name);
        else paths.push(`${userId}/${entry.name}`); // stray file directly under the user folder
      }
      for (const folder of folders) {
        const sub = await listLevel(`${userId}/${folder}`);
        for (const entry of sub) {
          if (entry.id === null) {
            throw new Error(
              `unexpected nested folder "${userId}/${folder}/${entry.name}" — aborting purge`,
            );
          }
          paths.push(`${userId}/${folder}/${entry.name}`);
        }
      }
      return paths;
    };

    // --- Step 1: purge imports/<user-id>/ from storage ---
    let purgedCount = 0;
    try {
      const paths = await collectUserFilePaths(user.id);
      for (let i = 0; i < paths.length; i += REMOVE_CHUNK_SIZE) {
        const chunk = paths.slice(i, i + REMOVE_CHUNK_SIZE);
        const { error: removeErr } = await admin.storage
          .from(IMPORTS_BUCKET)
          .remove(chunk);
        if (removeErr) {
          throw new Error(`storage remove failed: ${removeErr.message}`);
        }
        purgedCount += chunk.length;
      }
    } catch (purgeErr) {
      console.error(
        `[delete-account] storage purge failed for user ${user.id} ` +
          `(${purgedCount} file(s) removed before the error):`,
        purgeErr,
      );
      // Account is intact — the client tells the user to retry.
      return jsonResponse({ error: "storage_purge_failed" }, 500);
    }

    // --- Step 2: delete the auth user (DB cascades from auth.users) ---
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error(
        `[delete-account] auth.admin.deleteUser failed for user ${user.id} ` +
          `(storage already purged; retry will complete the deletion):`,
        deleteErr,
      );
      return jsonResponse({ error: "account_delete_failed" }, 500);
    }

    // Single non-PII operator log line (uuid + counts only) — deliberate
    // choice over a durable audit table; see PR / docs.
    console.log(
      `[delete-account] user ${user.id} erased: ${purgedCount} stored file(s) purged, auth user deleted, DB rows cascaded`,
    );
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[delete-account] unexpected error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
