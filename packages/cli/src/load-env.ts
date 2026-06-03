// Load monorepo-root `.env` before any other CLI code reads process.env.
//
// Resolution (in order):
// 1. If `AGENTSEA_ROOT` (or legacy `AGENTSEA_ROOT`) is set: load `$ROOT/.env` when the file exists.
// 2. Else walk up from `process.cwd()` (max 10 segments); if a directory contains both
//    `manifest.json` and `.env`, load that `.env`.
//
// Does not override variables already set in the environment (matches dotenv defaults).
//
// Diagnostics: set `AGENTSEA_DEBUG=1` or `AGENTSEA_DEBUG_ENV=1` to log which path was used
// (paths only — never values).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

function envDiagEnabled(): boolean {
  return process.env.AGENTSEA_DEBUG === "1" || process.env.AGENTSEA_DEBUG_ENV === "1";
}

function logEnvDiag(message: string): void {
  if (envDiagEnabled()) {
    process.stderr.write(`\x1b[2m[debug][env] ${message}\x1b[0m\n`);
  }
}

function tryLoad(path: string): void {
  if (existsSync(path)) {
    config({ path });
  }
}

function rootOverride(): string | undefined {
  return process.env.AGENTSEA_ROOT?.trim() || undefined;
}

/** Exported for tests — runs the same resolution rules as CLI startup. */
export function loadAgentSeaDotenv(): void {
  const root = rootOverride();
  if (root) {
    const envPath = join(root, ".env");
    if (existsSync(envPath)) {
      tryLoad(envPath);
      logEnvDiag(`Loaded dotenv file: ${envPath}`);
    } else {
      logEnvDiag(`AGENTSEA_ROOT set but no .env at ${envPath} — using process environment only`);
    }
  } else {
    let dir = process.cwd();
    let foundManifest = false;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, "manifest.json"))) {
        foundManifest = true;
        const envPath = join(dir, ".env");
        if (existsSync(envPath)) {
          tryLoad(envPath);
          logEnvDiag(`Loaded dotenv file: ${envPath} (manifest at ${join(dir, "manifest.json")})`);
        } else {
          logEnvDiag(
            `Found manifest.json at ${dir} but no .env — THEGRID_API_KEY / DIGITALOCEAN_* must come from the shell or AGENTSEA_ROOT`,
          );
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    if (!foundManifest) {
      logEnvDiag(
        `No repo-root manifest.json within 10 segments of cwd (${process.cwd()}) — dotenv auto-load skipped; use AGENTSEA_ROOT`,
      );
    }
  }
}

/** @deprecated Use loadAgentSeaDotenv */
export const loadGridAgentseaDotenv = loadAgentSeaDotenv;

loadAgentSeaDotenv();
