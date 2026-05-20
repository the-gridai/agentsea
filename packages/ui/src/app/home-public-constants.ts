/** Set in production via `NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN` (scheme required, no trailing slash). */
export const GRID_SPAWN_PUBLIC_ORIGIN_ENV_VAR = "NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN";

/** Obvious placeholder when the CDN origin env var is unset (must not look like a live product URL). */
export const GRID_SPAWN_PUBLIC_ORIGIN_UNSET = "https://next-public-grid-spawn-public-origin-not-set.invalid";

function spawnPublicOrigin(): string {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN
      ? process.env.NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN.trim()
      : "";
  if (!raw) {
    return GRID_SPAWN_PUBLIC_ORIGIN_UNSET;
  }
  const base = raw.replace(/\/+$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

export const GRID_SPAWN_PUBLIC_ORIGIN = spawnPublicOrigin();

export const isGridSpawnCdnConfigured = GRID_SPAWN_PUBLIC_ORIGIN !== GRID_SPAWN_PUBLIC_ORIGIN_UNSET;

export const GRID_SPAWN_INSTALL_URL = `${GRID_SPAWN_PUBLIC_ORIGIN}/install.sh`;

/** One-liner bootstrap example (DigitalOcean × OpenClaw). */
export const GRID_SPAWN_OPENCLAW_DO_ONELINER = `${GRID_SPAWN_PUBLIC_ORIGIN}/digitalocean/openclaw.sh`;

/** Websocket placeholder base (spawn detail, etc.). */
export function gridSpawnWsOrigin(): string {
  return GRID_SPAWN_PUBLIC_ORIGIN.replace(/^http/, "ws");
}

export const GRID_SPAWN_REQUEST_AGENT_MAILTO =
  "mailto:support@thegrid.ai?subject=Grid%20Spawn%20agent%20request&body=(Which%20agent%20and%20provider%20do%20you%20need%3F)";

export const THE_GRID_EXTERNAL_URL = "https://thegrid.dev";

/** Env var holding the user's The Grid platform API key (`grid-spawn`, agents, dashboards). */
export const THEGRID_API_KEY_ENV_VAR = "THEGRID_API_KEY";

/** Where users create Grid API keys in the dashboard (adjust path when canonical). */
export const THEGRID_API_KEYS_DASHBOARD_ORIGIN = "https://app.thegrid.ai";

/** Agents with end-to-end Grid chat verified on DigitalOcean (provision → configure → LLM). */
export const CHAT_VERIFIED_AGENT_SLUGS = ["claude", "cursor", "openclaw", "codex", "opencode"] as const;

export type ChatVerifiedAgentSlug = (typeof CHAT_VERIFIED_AGENT_SLUGS)[number];
