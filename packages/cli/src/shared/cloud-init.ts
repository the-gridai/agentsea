// shared/cloud-init.ts — Tier-based cloud-init package selection

import type { CloudInitTier } from "./agents.js";
import { shellQuote } from "./ui.js";

const MINIMAL = [
  "curl",
  "unzip",
  "git",
  "ca-certificates",
];

export function getPackagesForTier(tier: CloudInitTier = "full"): string[] {
  switch (tier) {
    case "minimal":
      return [
        ...MINIMAL,
      ];
    case "node":
      return [
        ...MINIMAL,
        "zsh",
        "build-essential",
        "python3",
        "python3-venv",
      ];
    case "bun":
      return [
        ...MINIMAL,
        "zsh",
      ];
    case "full":
      return [
        ...MINIMAL,
        "zsh",
        "build-essential",
      ];
  }
}

/** Node 22 install via `n` bootstrapped directly from curl (no apt nodejs/npm). */
export const NODE_INSTALL_CMD =
  "curl --proto '=https' -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n | bash -s install 22";

export function needsNode(tier: CloudInitTier = "full"): boolean {
  return tier === "node" || tier === "full";
}

export function needsBun(tier: CloudInitTier = "full"): boolean {
  return tier === "bun" || tier === "full";
}

/**
 * Apt bootstrap lines for cloud-init userdata on Debian/Ubuntu images.
 * DigitalOcean mirrors occasionally desync (hash/size mismatch on backports) — retry with backoff.
 */
export function cloudInitAptBootstrapLines(packages: string[]): string[] {
  const quotedPackages = packages.map((p) => shellQuote(p)).join(" ");
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "_apt_ok=0",
    "for _try in 1 2 3 4 5; do",
    "  if apt-get update -y -o Acquire::Retries=3; then _apt_ok=1; break; fi",
    "  echo \"apt-get update failed (attempt $_try/5) — mirror may be syncing; retrying...\" >&2",
    "  sleep $((_try * 5))",
    "done",
    'if [ "$_apt_ok" != 1 ]; then echo "warn: apt-get update failed after retries — using cached indexes" >&2; fi',
    "_inst_ok=0",
    "for _try in 1 2 3; do",
    `  if apt-get install -y --no-install-recommends -o Acquire::Retries=3 ${quotedPackages}; then _inst_ok=1; break; fi`,
    "  echo \"apt-get install failed (attempt $_try/3) — retrying...\" >&2",
    "  apt-get update -y -o Acquire::Retries=3 || true",
    "  sleep 5",
    "done",
    'if [ "$_inst_ok" != 1 ]; then echo "apt-get install failed after retries" >&2; exit 1; fi',
  ];
}

/**
 * Determines whether cloud-init wait should be skipped in favor of SSH-only wait.
 * Extracted from the inline condition in hetzner/main.ts and gcp/main.ts.
 */
export function shouldSkipCloudInit(opts: {
  useDocker: boolean;
  snapshotId?: string | null | undefined;
  skipCloudInit?: boolean;
}): boolean {
  return opts.useDocker || opts.snapshotId != null || (opts.skipCloudInit ?? false);
}
