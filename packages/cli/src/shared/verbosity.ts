/** Verbose provisioning logs (polling lines, API chatter, duplicated milestones). Enabled with `--verbose` or `AGENTSEA_VERBOSE=1`. */

export function isAgentseaVerbose(): boolean {
  const v = process.env.AGENTSEA_VERBOSE;
  return v === "1" || String(v ?? "").toLowerCase() === "true";
}
