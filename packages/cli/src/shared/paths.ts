// shared/paths.ts — Centralized filesystem path resolution for agentsea

import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Return the user's home directory, preferring $HOME over os.homedir(). */
export function getUserHome(): string {
  return process.env.HOME || homedir();
}

const CONFIG_SEGMENT = ".config/agentsea" as const;
const CACHE_DIR_NAME = "agentsea" as const;

function resolveAgentSeaHome(homePath: string): string {
  if (!isAbsolute(homePath)) {
    throw new Error(
      `AGENTSEA_HOME must be an absolute path (got "${homePath}").\n` +
        "Example: export AGENTSEA_HOME=/home/user/.config/agentsea",
    );
  }
  const resolved = resolve(homePath);
  const userHome = getUserHome();
  if (!resolved.startsWith(userHome + "/") && resolved !== userHome) {
    throw new Error(
      "AGENTSEA_HOME must be within your home directory.\n" + `Got: ${resolved}\n` + `Home: ${userHome}`,
    );
  }
  return resolved;
}

/** Resolve agentsea data dir (agentsea history lives here). Respects AGENTSEA_HOME. */
export function getAgentseaDir(): string {
  const agentSeaHome = process.env.AGENTSEA_HOME?.trim();
  if (agentSeaHome) {
    return resolveAgentSeaHome(agentSeaHome);
  }

  return join(getUserHome(), CONFIG_SEGMENT);
}

/** Path to the agentsea history file. */
export function getHistoryPath(): string {
  return join(getAgentseaDir(), "history.json");
}

/** Crash-safe provision checkpoints (~/.config/agentsea/runs/). */
export function getProvisionRunsDir(): string {
  return join(getAgentseaDir(), "runs");
}

/**
 * Per-cloud credential JSON: ~/.config/agentsea/{cloud}.json
 */
export function getAgentseaCloudConfigPath(cloud: string): string {
  return join(getAgentseaDir(), `${cloud}.json`);
}

export function getAgentseaPreferencesPath(): string {
  return join(getAgentseaDir(), "preferences.json");
}

/** OAuth device-flow session for The Grid exchange APIs. */
export function getGridOAuthSessionPath(): string {
  return join(getAgentseaDir(), "thegrid-oauth.json");
}

export function getInstallRefPath(): string {
  return join(getAgentseaDir(), ".ref");
}

export function getInstallIdPath(): string {
  return join(getAgentseaDir(), ".telemetry-id");
}

/** Manifest cache layout — ~/.cache/agentsea (honors XDG_CACHE_HOME). */
export function getCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(getUserHome(), ".cache"), CACHE_DIR_NAME);
}

export function getCacheFile(): string {
  return join(getCacheDir(), "manifest.json");
}

export function getUpdateFailedPath(): string {
  return join(getAgentseaDir(), ".update-failed");
}

export function getUpdateCheckedPath(): string {
  return join(getAgentseaDir(), ".update-checked");
}

export function getSshDir(): string {
  return join(getUserHome(), ".ssh");
}

export function getTmpDir(): string {
  return tmpdir();
}

export const RC_MARKER_START = "# >>> agentsea >>>";
export const RC_MARKER_END = "# <<< agentsea <<<";

export const RC_MARKER_LEGACY = "# Added by agentsea installer";
