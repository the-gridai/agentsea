/** Public Grid Spawn CDN / API origin — override with NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN (include scheme, no trailing slash). */
function spawnPublicOrigin(): string {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN
      ? process.env.NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN.trim()
      : "";
  const base = (raw || "https://spawn.thegrid.ai").replace(/\/+$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

export const GRID_SPAWN_PUBLIC_ORIGIN = spawnPublicOrigin();

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
