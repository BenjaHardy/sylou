// The seam between an edge function's handler and the outside world: the
// environment, the Supabase clients and the provider calls arrive as `deps`,
// so a test can drive a handler with fakes (_test_support.ts).
//
// Each index.ts serves `Deno.serve((req) => handler(req))`, never
// `Deno.serve(handler)`: Deno.serve passes a second argument (the connection
// info), which would land in `deps`. The imports are type-only, so no
// function bundles a library it did not load before.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import type { callLLM } from "./_llm.ts";

export interface HandlerDeps {
  /** Environment variables (Deno.env in production). */
  env: Pick<Deno.Env, "get">;
  /** Builds the user-scoped and the service-role Supabase clients. */
  createClient: typeof createClient;
  /** Every provider request the handler makes, directly or through its helpers. */
  callLLM: typeof callLLM;
}

/** config reads the environment only. */
export type EnvDeps = Pick<HandlerDeps, "env">;

/** share-report and delete-account make no provider call. */
export type ClientDeps = Pick<HandlerDeps, "env" | "createClient">;
