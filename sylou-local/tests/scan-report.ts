// T50: what Grype found in an image or an SBOM, and whether it stops CI.
//
// D22: an image of ours fails on a HIGH or CRITICAL flaw that has a fix -
// one we could take by rebuilding or bumping. Supabase's images are reported
// and do not fail: they move together, one tested snapshot at a time (D20).
//
//   grype <target> -o json > scan.json
//   deno run --allow-read --allow-env tests/scan-report.ts scan.json <name> ours|reported

export interface Match {
  vulnerability: { id: string; severity?: string; fix?: { state?: string; versions?: string[] } };
  artifact: { name: string; version: string; type?: string };
}

/** The flaws D22 counts: serious, and with a fix to take. */
export function serious(matches: Match[]): Match[] {
  return matches.filter((match) =>
    ["High", "Critical"].includes(match.vulnerability.severity ?? "") && match.vulnerability.fix?.state === "fixed"
  );
}

export function line(match: Match): string {
  const fix = match.vulnerability.fix?.versions?.join(", ") || "a newer version";
  return `${match.vulnerability.id} (${match.vulnerability.severity}) in ${match.artifact.name} ` +
    `${match.artifact.version} (${match.artifact.type ?? "?"}): fixed in ${fix}`;
}

if (import.meta.main) {
  const [file, name, kind] = Deno.args;
  if (!file || !name || (kind !== "ours" && kind !== "reported")) {
    console.error("usage: scan-report.ts <grype.json> <name> ours|reported");
    Deno.exit(2);
  }
  const matches = (JSON.parse(await Deno.readTextFile(file)).matches ?? []) as Match[];
  const found = serious(matches);
  const ci = Deno.env.get("GITHUB_ACTIONS") === "true";
  const escape = (text: string) => text.replaceAll("%", "%25").replaceAll(":", "%3A").replaceAll(",", "%2C");
  const level = kind === "ours" ? "error" : "notice";

  console.log(`${name}: ${matches.length} known flaw(s), ${found.length} HIGH or CRITICAL with a fix`);
  for (const match of found) console.log(`  ${line(match)}`);
  if (ci && found.length > 0) {
    // Annotations are capped per step, so a long list is one message.
    const shown = found.slice(0, 25).map(line);
    if (found.length > shown.length) shown.push(`... and ${found.length - shown.length} more`);
    console.log(`::${level} title=${escape(`T50 ${name}`)}::${shown.join("%0A")}`);
  }
  Deno.exit(kind === "ours" && found.length > 0 ? 1 : 0);
}
