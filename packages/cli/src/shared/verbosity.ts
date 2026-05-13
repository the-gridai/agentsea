/** Verbose provisioning logs (polling lines, API chatter, duplicated milestones). Enabled with `--verbose` or `SPAWN_VERBOSE=1`. */

export function isSpawnVerbose(): boolean {
  const v = process.env.SPAWN_VERBOSE;
  return v === "1" || String(v ?? "").toLowerCase() === "true";
}
