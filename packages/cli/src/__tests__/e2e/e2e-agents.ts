import { existsSync } from "node:fs";

/**
 * Canonical E2E agent slugs - keep in sync with `sh/e2e/lib/common.sh` ALL_AGENTS.
 */
export const E2E_AGENT_SLUGS = [
  "claude",
  "openclaw",
  "codex",
  "opencode",
  "kilocode",
  "hermes",
  "junie",
  "cursor",
  "pi",
  "t3code",
] as const;

export type E2eAgentSlug = (typeof E2E_AGENT_SLUGS)[number];

/** Comma/space-separated override via GRIDAGENTSEA_E2E_AGENTS; default = all slugs. */
export function e2eAgentListFromEnv(): string[] {
  const raw = process.env.GRIDAGENTSEA_E2E_AGENTS?.trim();
  if (!raw) return [...E2E_AGENT_SLUGS];
  return raw.split(/[\s,]+/).filter(Boolean);
}

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
