/** Set in production via `NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN` (scheme required, no trailing slash). */
export const AGENTSEA_PUBLIC_ORIGIN_ENV_VAR = "NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN";

/** Obvious placeholder when the CDN origin env var is unset (must not look like a live product URL). */
export const AGENTSEA_PUBLIC_ORIGIN_UNSET = "https://next-public-agentsea-public-origin-not-set.invalid";

function agentSeaPublicOrigin(): string {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN
      ? process.env.NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN.trim()
      : "";
  if (!raw) {
    return AGENTSEA_PUBLIC_ORIGIN_UNSET;
  }
  const base = raw.replace(/\/+$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

export const AGENTSEA_PUBLIC_ORIGIN = agentSeaPublicOrigin();

export const isAgentSeaCdnConfigured = AGENTSEA_PUBLIC_ORIGIN !== AGENTSEA_PUBLIC_ORIGIN_UNSET;

export const AGENTSEA_INSTALL_URL = `${AGENTSEA_PUBLIC_ORIGIN}/install.sh`;

/** Websocket placeholder base (agentsea detail, etc.). */
export function agentSeaWsOrigin(): string {
  return AGENTSEA_PUBLIC_ORIGIN.replace(/^http/, "ws");
}

export const AGENTSEA_REQUEST_AGENT_MAILTO =
  "mailto:support@thegrid.ai?subject=AgentSea%20agent%20request&body=(Which%20agent%20and%20provider%20do%20you%20need%3F)";

export const THE_GRID_EXTERNAL_URL = "https://thegrid.dev";

/** Env var holding the user's The Grid platform API key (`agentsea`, agents, dashboards). */
export const THEGRID_API_KEY_ENV_VAR = "THEGRID_API_KEY";

/** Where users create Grid API keys in the dashboard (adjust path when canonical). */
export const THEGRID_API_KEYS_DASHBOARD_ORIGIN = "https://app.thegrid.ai";

/**
 * Homepage agents only. Junie/Pi/Cursor/Codex/T3 are disabled in manifest until tool E2E passes.
 * Hermes is included — provision/configure verified; automated input test skipped (TUI-only).
 */
export const CHAT_VERIFIED_AGENT_SLUGS = [
  "openclaw",
  "hermes",
  "kilocode",
  "claude",
  "opencode",
] as const;

export type ChatVerifiedAgentSlug = (typeof CHAT_VERIFIED_AGENT_SLUGS)[number];

/** Cloud providers shown on the homepage launch flow (Step 2). */
export const HOME_CLOUD_SLUGS = ["local", "digitalocean", "linode"] as const;

export type HomeCloudSlug = (typeof HOME_CLOUD_SLUGS)[number];

export const HOME_CLOUD_COMING_SOON = new Set<string>(["linode"]);

/** Placeholder copy for Linode until manifest support lands. */
export const LINODE_PLACEHOLDER = {
  name: "Linode",
  description: "Akamai cloud servers (account required)",
} as const;

/** Local path to DigitalOcean logo in `public/clouds/`. */
export const DIGITALOCEAN_LOGO_PATH = "/clouds/digitalocean.png";

/** Local path to Linode logo in `public/clouds/`. */
export const LINODE_LOGO_PATH = "/clouds/linode.png";

/** DigitalOcean token env var (matches manifest + CLI aliases). */
export const DIGITALOCEAN_ACCESS_TOKEN_ENV_VAR = "DIGITALOCEAN_ACCESS_TOKEN";
