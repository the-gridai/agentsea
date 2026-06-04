// shared/ssh-keys.ts — Agentsea-owned SSH key with legacy fallback for back-compat

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { getSshDir } from "./paths.js";
import { isFileError, tryCatch, tryCatchIf, unwrapOr } from "./result.js";
import { logInfo, logStep } from "./ui.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SshKeyPair {
  privPath: string;
  pubPath: string;
  /** Base name, e.g. "agentsea_ed25519" or "id_rsa" */
  name: string;
  /** Key algorithm, e.g. "ED25519", "RSA" */
  type: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Filename of the agentsea-managed key under ~/.ssh/. */
export const AGENTSEA_KEY_NAME = "agentsea_ed25519";

/** Default key filenames OpenSSH auto-tries; used as legacy -i fallbacks
 * so droplets provisioned by older Agentsea versions stay reachable. */
const LEGACY_KEY_NAMES = [
  "id_ed25519",
  "id_rsa",
  "id_ecdsa",
];

/** Cap the total number of -i flags to stay under a typical sshd MaxAuthTries. */
const MAX_KEYS = 3;

// ─── Module-level cache ─────────────────────────────────────────────────────

let cachedAgentseaKey: SshKeyPair | null = null;
let cachedKeys: SshKeyPair[] | null = null;

/** Reset the module-level cache (for testing). */
export function _resetCache(): void {
  cachedAgentseaKey = null;
  cachedKeys = null;
}

// ─── Pubkey helpers ─────────────────────────────────────────────────────────

/**
 * Read the first two whitespace-separated fields ("type base64") from an OpenSSH
 * public key string, ignoring trailing comment. Returns "" if the input is empty
 * or malformed.
 */
function pubKeyCore(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return "";
  }
  return `${parts[0]} ${parts[1]}`;
}

/**
 * Derive the public key text from a private key via `ssh-keygen -y`.
 * Returns the raw stdout (e.g. `"ssh-ed25519 AAAA... comment\n"`) on success,
 * or "" when the private key is passphrase-protected, corrupt, or missing.
 */
function derivePubFromPriv(privPath: string): string {
  return unwrapOr(
    tryCatch(() => {
      const result = Bun.spawnSync(
        [
          "ssh-keygen",
          "-y",
          "-P",
          "",
          "-f",
          privPath,
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      );
      if (result.exitCode !== 0) {
        return "";
      }
      return new TextDecoder().decode(result.stdout);
    }),
    "",
  );
}

/**
 * Verify that a private/public keypair on disk are actually paired:
 * derive the public key from the private key and compare to the `.pub`.
 *
 * Returns:
 *   - "match"        — derived public matches `.pub`
 *   - "mismatch"     — files exist but do NOT pair (silent-failure source)
 *   - "unverifiable" — passphrase-protected, corrupt, or otherwise can't derive
 */
export function verifyKeyPair(privPath: string, pubPath: string): "match" | "mismatch" | "unverifiable" {
  const derivedCore = pubKeyCore(derivePubFromPriv(privPath));
  if (!derivedCore) {
    return "unverifiable";
  }

  const pubText = unwrapOr(
    tryCatchIf(isFileError, () => readFileSync(pubPath, "utf-8")),
    "",
  );
  const pubCore = pubKeyCore(pubText);
  if (!pubCore) {
    return "unverifiable";
  }

  return derivedCore === pubCore ? "match" : "mismatch";
}

/**
 * Repair a stale `.pub` file by rewriting it from the matching private key.
 *
 * The original `.pub` is preserved as `<pubPath>.agentsea-backup-<timestamp>` so
 * the user can inspect what was replaced. Returns the backup path on success,
 * or null if the private key couldn't be read or the filesystem write failed.
 */
export function repairPubFromPriv(privPath: string, pubPath: string): string | null {
  const derived = derivePubFromPriv(privPath);
  if (!pubKeyCore(derived)) {
    return null;
  }

  const backupPath = `${pubPath}.agentsea-backup-${Date.now()}`;
  const result = tryCatchIf(isFileError, () => {
    renameSync(pubPath, backupPath);
    writeFileSync(pubPath, derived, {
      mode: 0o644,
    });
  });
  if (!result.ok) {
    return null;
  }
  return backupPath;
}

/** Extract the key type from a public key file using ssh-keygen. */
function getKeyType(pubPath: string): string {
  return unwrapOr(
    tryCatch(() => {
      const result = Bun.spawnSync(
        [
          "ssh-keygen",
          "-lf",
          pubPath,
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      );
      const output = new TextDecoder().decode(result.stdout).trim();
      // Format: "256 SHA256:xxx user@host (ED25519)"
      const match = output.match(/\(([^)]+)\)$/);
      return match ? match[1] : "UNKNOWN";
    }),
    "UNKNOWN",
  );
}

/** Get the MD5 fingerprint of a public key (for cloud provider matching). */
export function getSshFingerprint(pubPath: string): string {
  return unwrapOr(
    tryCatch(() => {
      const result = Bun.spawnSync(
        [
          "ssh-keygen",
          "-lf",
          pubPath,
          "-E",
          "md5",
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      );
      const output = new TextDecoder().decode(result.stdout).trim();
      // Format: "2048 MD5:xx:xx:xx... user@host (ED25519)"
      const match = output.match(/MD5:([a-f0-9:]+)/i);
      return match ? match[1] : "";
    }),
    "",
  );
}

// ─── Agentsea Key Management ───────────────────────────────────────────────────

/**
 * Ensure the agentsea-managed ed25519 key exists at ~/.ssh/agentsea_ed25519 and
 * return it. Generated on first use, then cached. The custom filename avoids
 * clobbering the user's personal `id_ed25519` and keeps Agentsea's key isolated
 * from the rest of their SSH setup.
 */
export function getAgentseaKey(): SshKeyPair {
  if (cachedAgentseaKey) {
    return cachedAgentseaKey;
  }

  const sshDir = getSshDir();
  const privPath = `${sshDir}/${AGENTSEA_KEY_NAME}`;
  const pubPath = `${privPath}.pub`;

  mkdirSync(sshDir, {
    recursive: true,
    mode: 0o700,
  });

  if (existsSync(privPath) && existsSync(pubPath)) {
    cachedAgentseaKey = {
      privPath,
      pubPath,
      name: AGENTSEA_KEY_NAME,
      type: getKeyType(pubPath),
    };
    return cachedAgentseaKey;
  }

  logStep("Generating Agentsea SSH key...");
  const result = Bun.spawnSync(
    [
      "ssh-keygen",
      "-t",
      "ed25519",
      "-f",
      privPath,
      "-N",
      "",
      "-C",
      "agentsea",
    ],
    {
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  );
  if (result.exitCode !== 0) {
    // Race: another process may have created the key between our check and ssh-keygen.
    if (existsSync(privPath) && existsSync(pubPath)) {
      cachedAgentseaKey = {
        privPath,
        pubPath,
        name: AGENTSEA_KEY_NAME,
        type: getKeyType(pubPath),
      };
      return cachedAgentseaKey;
    }
    throw new Error("Agentsea SSH key generation failed");
  }
  logInfo(`Agentsea SSH key generated at ~/.ssh/${AGENTSEA_KEY_NAME}`);

  cachedAgentseaKey = {
    privPath,
    pubPath,
    name: AGENTSEA_KEY_NAME,
    type: "ED25519",
  };
  return cachedAgentseaKey;
}

/**
 * Discover pre-existing default-named keys (id_ed25519, id_rsa, id_ecdsa) in
 * ~/.ssh/, excluding the agentsea-managed key. Used as -i fallbacks so droplets
 * provisioned by older Agentsea versions (which registered the user's personal
 * keys with the cloud account) remain SSH-reachable.
 *
 * Stale .pub files are auto-repaired against their .priv (the .priv is
 * authoritative; a non-derivable .pub is wrong by definition). Passphrase-
 * protected and unverifiable pairs are skipped silently — BatchMode SSH can't
 * use those without an active ssh-agent anyway.
 */
export function discoverLegacyKeys(): SshKeyPair[] {
  const sshDir = getSshDir();
  if (!existsSync(sshDir)) {
    return [];
  }

  const pairs: SshKeyPair[] = [];
  for (const baseName of LEGACY_KEY_NAMES) {
    if (baseName === AGENTSEA_KEY_NAME) {
      continue;
    }
    const privPath = `${sshDir}/${baseName}`;
    const pubPath = `${privPath}.pub`;
    if (!existsSync(privPath) || !existsSync(pubPath)) {
      continue;
    }

    const verification = verifyKeyPair(privPath, pubPath);
    if (verification === "mismatch") {
      const repaired = repairPubFromPriv(privPath, pubPath);
      if (!repaired) {
        continue;
      }
    } else if (verification === "unverifiable") {
      continue;
    }

    pairs.push({
      privPath,
      pubPath,
      name: baseName,
      type: getKeyType(pubPath),
    });
  }
  return pairs;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Return the keys to offer when SSHing to a Agentsea-managed VM.
 *
 * - First entry is always the agentsea-managed key (generated if missing) — this
 *   is what new VMs are provisioned with.
 * - Followed by any pre-existing default-named keys as legacy -i fallbacks
 *   so VMs provisioned by older Agentsea versions remain reachable.
 * - Capped at MAX_KEYS so we stay under a typical sshd MaxAuthTries (6).
 *
 * Cached at module level so subsequent calls return instantly.
 */
export async function ensureSshKeys(): Promise<SshKeyPair[]> {
  if (cachedKeys) {
    return cachedKeys;
  }

  const agentseaKey = getAgentseaKey();
  const legacy = discoverLegacyKeys();
  cachedKeys = [
    agentseaKey,
    ...legacy,
  ].slice(0, MAX_KEYS);
  return cachedKeys;
}

// ─── SSH Opts Helper ────────────────────────────────────────────────────────

/**
 * Build SSH identity file options for all selected keys.
 * Returns ["-i", path1, "-i", path2, ...].
 */
export function getSshKeyOpts(keys: SshKeyPair[]): string[] {
  const opts: string[] = [];
  for (const key of keys) {
    opts.push("-i", key.privPath);
  }
  return opts;
}
