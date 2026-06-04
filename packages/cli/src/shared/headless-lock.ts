// Headless provisioning guard — avoids duplicate droplets when a script restarts the CLI
// while an earlier process is still creating a VM (see sh/digitalocean/openclaw.sh).

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getProvisionRunsDir } from "./paths.js";
import { logError } from "./ui.js";

const LOCK_NAME = "headless-provision.lock";
const STALE_MS = 45 * 60 * 1000;

let lockPathHeld: string | undefined;

function readLockAgeMs(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf-8").trim().split("\n");
    const t = Number(raw[1]);
    if (!Number.isFinite(t)) {
      return null;
    }
    return Date.now() - t;
  } catch {
    return null;
  }
}

/** Single-flight guard for AGENTSEA_HEADLESS=1 VM creates. No-op when not headless. */
export function acquireHeadlessProvisionLock(): void {
  if (process.env.AGENTSEA_HEADLESS !== "1") {
    return;
  }

  const dir = getProvisionRunsDir();
  mkdirSync(dir, {
    recursive: true,
    mode: 0o700,
  });
  const lockPath = join(dir, LOCK_NAME);

  if (existsSync(lockPath)) {
    const age = readLockAgeMs(lockPath);
    if (age !== null && age < STALE_MS) {
      logError(
        "Another headless agentsea provision may still be running (lock file present).\n" +
          `  ${lockPath}\n` +
          "If the other process exited uncleanly, remove the lock after confirming no create is in flight.",
      );
      process.exit(1);
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* best-effort */
    }
  }

  writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`, {
    mode: 0o600,
  });
  lockPathHeld = lockPath;

  const release = (): void => {
    if (!lockPathHeld) {
      return;
    }
    try {
      unlinkSync(lockPathHeld);
    } catch {
      /* ignore */
    }
    lockPathHeld = undefined;
  };

  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });
}
