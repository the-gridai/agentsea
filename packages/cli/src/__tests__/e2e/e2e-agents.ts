import { existsSync } from "node:fs";

/**
 * Canonical E2E agent slugs - keep in sync with `sh/e2e/lib/common.sh` ALL_AGENTS.
 */
export const E2E_AGENT_SLUGS = [
  "claude",
  "openclaw",
  "opencode",
  "kilocode",
  "hermes",
] as const;

/** Disabled for users — broken tool path or no verified tool E2E; opt in via GRIDAGENTSEA_E2E_AGENTS= */
export const E2E_DISABLED_AGENT_SLUGS = ["cursor", "codex", "t3code", "junie", "pi"] as const;

/** @deprecated use E2E_DISABLED_AGENT_SLUGS */
export const E2E_DEPRECATED_AGENT_SLUGS = E2E_DISABLED_AGENT_SLUGS;

export type E2eAgentSlug = (typeof E2E_AGENT_SLUGS)[number];

/** Comma/space-separated override via GRIDAGENTSEA_E2E_AGENTS; default = all slugs. */
export function e2eAgentListFromEnv(): string[] {
  const raw = process.env.GRIDAGENTSEA_E2E_AGENTS?.trim();
  if (!raw) return [...E2E_AGENT_SLUGS];
  return raw.split(/[\s,]+/).filter(Boolean);
}

/** Spreadsheet row IDs for E2E regression mapping (Grid Spawn Findings). */
export const E2E_SPREADSHEET_ISSUE_BY_AGENT: Record<string, string> = {
  claude: "#2,#4",
  openclaw: "#1,#34",
  codex: "#15,#38",
  opencode: "#27,#33",
  kilocode: "#39,#40",
  hermes: "#14,#25,#28,#31",
  junie: "#36",
  pi: "#35",
  t3code: "#15,#38",
  cursor: "#41,#42",
};

export function digitalOceanToken(): string | undefined {
  return (
    process.env.DIGITALOCEAN_ACCESS_TOKEN ||
    process.env.DIGITALOCEAN_API_TOKEN ||
    process.env.DO_API_TOKEN ||
    undefined
  );
}

export function canRunDigitalOceanE2e(e2eScriptPath: string): { ok: boolean; reason: string } {
  if (process.env.GRIDAGENTSEA_RUN_DO_E2E !== "1") {
    return {
      ok: false,
      reason: "Set GRIDAGENTSEA_RUN_DO_E2E=1 to provision real DigitalOcean VMs and run sh/e2e/e2e.sh.",
    };
  }
  if (!process.env.THEGRID_API_KEY?.trim()) {
    return { ok: false, reason: "THEGRID_API_KEY is required for DigitalOcean E2E." };
  }
  if (!digitalOceanToken()) {
    return {
      ok: false,
      reason: "One of DIGITALOCEAN_ACCESS_TOKEN, DIGITALOCEAN_API_TOKEN, or DO_API_TOKEN is required.",
    };
  }
  if (!existsSync(e2eScriptPath)) {
    return { ok: false, reason: `E2E script not found: ${e2eScriptPath}` };
  }
  return { ok: true, reason: "" };
}
