// Uploaded files: in the private imports bucket, each user lists, reads,
// adds, renames and deletes files in their own folder only (the folder named
// by their user id), the Storage service running each request in the
// caller's role; signed-out visitors get nothing, and users cannot change the
// bucket. The size and type limits are the Storage service's to enforce, so
// here they are checked as the bucket's settings.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import { assertBlocked, assertDenied, assertSucceeded, type Caller, inTransaction, type Session } from "./db.ts";

/** A file's row as JSON text, read as the database owner. */
async function file(s: Session, name: string): Promise<string | undefined> {
  await s.asOwner();
  const [row] = await s.rows<{ row: string }>(
    "SELECT row_to_json(o)::text AS row FROM storage.objects o WHERE bucket_id = 'imports' AND name = $1",
    [name],
  );
  return row?.row;
}

/** `caller`'s attempts at B's file with `sql` (an UPDATE or DELETE without
 * WHERE): aimed at the file, then sent without a WHERE clause, which leaves
 * the UPDATE or DELETE policy alone to pick the rows. B's file is unchanged
 * afterwards. */
async function assertUntouched(s: Session, caller: Caller, sql: string, params: unknown[], what: string) {
  const before = await file(s, B.file);
  assert(before, `${what}: B's file is missing`);
  await s.as(caller);
  assertBlocked(await s.attempt(`${sql} WHERE name = $${params.length + 1}`, [...params, B.file]), what);
  await s.attempt(sql, params);
  assertEquals(await file(s, B.file), before, `${what}: B's file changed`);
}

const insert = "INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2)";
// Moves every file the caller may rename into one folder, each under a fresh
// name. The statement reads no column: reading one, even in SET, would add
// the SELECT policy's check and hide a broken UPDATE policy.
const moveInto = "UPDATE storage.objects SET name = $1 || '/' || gen_random_uuid()::text";

Deno.test("A sees its own files and none of B's", () =>
  inTransaction(async (s) => {
    assert(await file(s, B.file), "B's file is missing");
    await s.as({ user: A.user });
    const names = await s.rows<{ name: string }>(
      "SELECT name FROM storage.objects WHERE bucket_id = 'imports' ORDER BY name",
    );
    assertEquals(names.map((n) => n.name), [A.file]);
  }));

Deno.test("A adds, renames and deletes files in its own folder", () =>
  inTransaction(async (s) => {
    await s.as({ user: A.user });
    assertSucceeded(await s.attempt(insert, ["imports", `${A.user}/added.txt`]), 1, "uploading into A's folder");
    assertSucceeded(
      await s.attempt("UPDATE storage.objects SET name = $1 WHERE name = $2", [`${A.user}/renamed.txt`, A.file]),
      1,
      "renaming A's file",
    );
    assertSucceeded(
      await s.attempt("DELETE FROM storage.objects WHERE name = $1", [`${A.user}/renamed.txt`]),
      1,
      "deleting A's file",
    );
  }));

Deno.test("A cannot add files outside its own folder", async (t) => {
  const uploads: Array<[what: string, bucket: string, name: string]> = [
    ["into B's folder", "imports", `${B.user}/added.txt`],
    ["outside any folder", "imports", "added.txt"],
    ["into another bucket", "other", `${A.user}/added.txt`],
  ];
  for (const [what, bucket, name] of uploads) {
    await t.step(what, () =>
      inTransaction(async (s) => {
        await s.as({ user: A.user });
        assertDenied(await s.attempt(insert, [bucket, name]), `uploading ${what}`);
      }));
  }
});

Deno.test("A cannot change, take or delete B's files", async (t) => {
  await t.step("change", () =>
    inTransaction((s) =>
      assertUntouched(s, { user: A.user }, "UPDATE storage.objects SET metadata = $1", ['{"changed": true}'], "changing B's file")
    ));

  await t.step("take into A's folder", () =>
    inTransaction((s) => assertUntouched(s, { user: A.user }, moveInto, [A.user], "taking B's file")));

  await t.step("delete", () =>
    inTransaction((s) => assertUntouched(s, { user: A.user }, "DELETE FROM storage.objects", [], "deleting B's file")));
});

Deno.test("A cannot move its own files into B's folder", () =>
  inTransaction(async (s) => {
    const before = await file(s, A.file);
    await s.as({ user: A.user });
    assertDenied(await s.attempt(moveInto, [B.user]), "moving A's files into B's folder");
    assertEquals(await file(s, A.file), before);
  }));

Deno.test("signed out, the bucket shows and accepts nothing", () =>
  inTransaction(async (s) => {
    const before = [await file(s, A.file), await file(s, B.file)];
    await s.as("anon");
    assertEquals(await s.count("SELECT 1 FROM storage.objects"), 0);
    assertDenied(await s.attempt(insert, ["imports", `${A.user}/added.txt`]), "uploading signed out");
    assertBlocked(await s.attempt("UPDATE storage.objects SET metadata = '{}'"), "changing files signed out");
    assertBlocked(await s.attempt(moveInto, [A.user]), "renaming files signed out");
    assertBlocked(await s.attempt("DELETE FROM storage.objects"), "deleting files signed out");
    assertEquals([await file(s, A.file), await file(s, B.file)], before);
  }));

Deno.test("the imports bucket is private, with the app's size and type limits", async () => {
  let bucket: Record<string, unknown> | undefined;
  await inTransaction(async (s) => {
    [bucket] = await s.rows(
      `SELECT public, file_size_limit::int AS size_limit, allowed_mime_types AS types
       FROM storage.buckets WHERE id = 'imports'`,
    );
  });
  assertEquals(bucket, {
    public: false,
    size_limit: 10 * 1024 * 1024,
    types: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
    ],
  });
});

Deno.test("users cannot change the bucket or add buckets", async (t) => {
  for (const [who, caller] of [["signed in", { user: A.user }], ["signed out", "anon"]] as Array<[string, Caller]>) {
    await t.step(who, () =>
      inTransaction(async (s) => {
        const bucket = async () => {
          await s.asOwner();
          return (await s.rows("SELECT row_to_json(b)::text AS row FROM storage.buckets b ORDER BY id"))
            .map((r) => r.row);
        };
        const before = await bucket();
        await s.as(caller);
        assertBlocked(
          await s.attempt("UPDATE storage.buckets SET public = true, file_size_limit = NULL"),
          `${who}: opening the bucket`,
        );
        assertDenied(
          await s.attempt("INSERT INTO storage.buckets (id, name, public) VALUES ('mine', 'mine', true)"),
          `${who}: adding a bucket`,
        );
        assertBlocked(await s.attempt("DELETE FROM storage.buckets"), `${who}: deleting the bucket`);
        assertEquals(await bucket(), before);
      }));
  }
});
