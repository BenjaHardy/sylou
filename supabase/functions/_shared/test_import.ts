// Probe file for the _shared/ cross-folder import investigation.
// Imported from supabase/functions/analysis/index.ts at the top of the file.
// If the analysis function deploys + responds successfully, _shared/ imports
// are viable in this project's Supabase deployment and we can consolidate
// _llm.ts / _repair.ts / _temperatures.ts into single canonical copies
// here in a follow-up PR.
//
// If deployment or the analysis function fails with a module-resolution
// error, capture the exact error message — that's the artifact worth
// filing with Supabase support.

export function sharedImportProbe(): string {
  return "shared-import-ok";
}
