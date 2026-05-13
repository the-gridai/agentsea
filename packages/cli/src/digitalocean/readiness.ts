// digitalocean/readiness.ts — Pre-flight READY/BLOCKED evaluation + guided CLI gate

import * as p from "@clack/prompts";
import { handleBillingError } from "../shared/billing-guidance.js";
import { getOrPromptApiKey, loadSavedTheGridApiKey, verifyTheGridApiKey } from "../shared/oauth.js";
import { getSpawnKey } from "../shared/ssh-keys.js";
import { logAlwaysInfo, logAlwaysStep, logError, logWarn, openBrowser, prompt } from "../shared/ui.js";
import { DIGITALOCEAN_BILLING_ADD_PAYMENT_URL, digitaloceanBilling } from "./billing.js";
import {
  areSshKeysRegisteredOnDigitalOcean,
  ensureDoToken,
  ensureSshKey,
  fetchDoAccountSnapshot,
  getDropletCount,
  preloadDigitalOceanApiTokenForReadiness,
} from "./digitalocean.js";
import { renderReadinessChecklist } from "./readiness-checklist.js";
import { isInteractiveTTY } from "../commands/shared.js";

const DO_PROFILE_URL = "https://cloud.digitalocean.com/account/profile";
const DO_DROPLETS_URL = "https://cloud.digitalocean.com/droplets";

/** Ordered blocker codes returned by {@link evaluateDigitalOceanReadiness}. */
export type ReadinessBlockerCode =
  | "do_auth"
  | "email_unverified"
  | "payment_required"
  | "ssh_missing"
  | "grid_api_key_missing"
  | "droplet_limit";

export interface ReadinessState {
  status: "READY" | "BLOCKED";
  blockers: ReadinessBlockerCode[];
}

/** Resolution order: fix billing before SSH registration — DO often rejects key upload until payment is set up. */
const BLOCKER_ORDER: ReadinessBlockerCode[] = [
  "do_auth",
  "email_unverified",
  "payment_required",
  "ssh_missing",
  "grid_api_key_missing",
  "droplet_limit",
];

export function sortBlockers(codes: ReadinessBlockerCode[]): ReadinessBlockerCode[] {
  const uniq = [
    ...new Set(codes),
  ];
  return uniq.sort((a, b) => BLOCKER_ORDER.indexOf(a) - BLOCKER_ORDER.indexOf(b));
}

async function hasValidGridApiKey(): Promise<boolean> {
  const envKey = process.env.THEGRID_API_KEY;
  if (envKey && (await verifyTheGridApiKey(envKey))) {
    return true;
  }
  const saved = loadSavedTheGridApiKey();
  if (saved && (await verifyTheGridApiKey(saved))) {
    return true;
  }
  return false;
}

/**
 * Evaluate DigitalOcean + Grid API key readiness using `GET /v2/account` only (no billing APIs).
 */
export async function evaluateDigitalOceanReadiness(_agentName: string): Promise<ReadinessState> {
  void _agentName;
  const blockers: ReadinessBlockerCode[] = [];

  const hadTokenBeforeAccount = preloadDigitalOceanApiTokenForReadiness();
  const snapshot = await fetchDoAccountSnapshot();
  if (!snapshot) {
    if (!hadTokenBeforeAccount) {
      logWarn(
        "DigitalOcean readiness: no API token in CLI state. Set DIGITALOCEAN_ACCESS_TOKEN (or DIGITALOCEAN_API_TOKEN / DO_API_TOKEN), add a repo-root .env beside manifest.json, or run without --headless to sign in.",
      );
    }
    return {
      status: "BLOCKED",
      blockers: sortBlockers([
        "do_auth",
      ]),
    };
  }

  const dropletLimit = snapshot.droplet_limit;
  if (dropletLimit > 0) {
    const count = await getDropletCount();
    if (count !== null && count >= dropletLimit) {
      blockers.push("droplet_limit");
    }
  }

  if (snapshot.email_verified === false) {
    blockers.push("email_unverified");
  }

  // `locked` = billing suspended; `warning` = account needs attention (often payment verification before first resource)
  if (snapshot.status === "locked" || snapshot.status === "warning") {
    blockers.push("payment_required");
  }

  if (!(await areSshKeysRegisteredOnDigitalOcean())) {
    blockers.push("ssh_missing");
  }

  if (!(await hasValidGridApiKey())) {
    blockers.push("grid_api_key_missing");
  }

  if (blockers.length === 0) {
    return {
      status: "READY",
      blockers: [],
    };
  }

  return {
    status: "BLOCKED",
    blockers: sortBlockers(blockers),
  };
}

async function resolveFirstBlocker(first: ReadinessBlockerCode, agentName: string): Promise<void> {
  switch (first) {
    case "do_auth": {
      logAlwaysStep("Connect your DigitalOcean account...");
      await ensureDoToken();
      break;
    }
    case "droplet_limit": {
      logAlwaysStep("Droplet limit reached. Delete a droplet in the control panel or raise your limit, then continue.");
      openBrowser(DO_DROPLETS_URL);
      await prompt("Press Enter after freeing capacity to re-check...");
      break;
    }
    case "email_unverified": {
      logAlwaysStep("Verify your DigitalOcean email to continue.");
      openBrowser(DO_PROFILE_URL);
      await prompt("Press Enter after verifying your email to re-check...");
      break;
    }
    case "payment_required": {
      logAlwaysStep("Your DigitalOcean account needs billing attention.");
      await handleBillingError(digitaloceanBilling);
      break;
    }
    case "ssh_missing": {
      logAlwaysStep("Registering SSH keys with DigitalOcean...");
      await ensureSshKey();
      logAlwaysInfo("SSH keys updated.");
      break;
    }
    case "grid_api_key_missing": {
      logAlwaysStep("Add a valid The Grid API key to continue.");
      await getOrPromptApiKey(agentName, "digitalocean");
      break;
    }
  }
}

/**
 * Interactive loop until READY or process exit (non-interactive).
 * Ensures SSH keys are registered and a Grid API key is available before returning.
 */
export async function runDigitalOceanReadinessGate(opts: { agentName: string }): Promise<void> {
  const { agentName } = opts;

  const canPrompt =
    isInteractiveTTY() && process.env.SPAWN_NON_INTERACTIVE !== "1" && process.env.SPAWN_HEADLESS !== "1";
  if (canPrompt) {
    preloadDigitalOceanApiTokenForReadiness();
    let snapshot = await fetchDoAccountSnapshot();
    if (!snapshot) {
      await ensureDoToken();
      preloadDigitalOceanApiTokenForReadiness();
      snapshot = await fetchDoAccountSnapshot();
    }
    if (!snapshot) {
      logWarn("DigitalOcean account could not be verified yet — readiness checks may ask you to sign in again.");
    }
    if (!(await hasValidGridApiKey())) {
      await getOrPromptApiKey(agentName, "digitalocean");
    }
  }

  let previousTopBlocker: ReadinessBlockerCode | undefined;
  let sameTopBlockerRepeats = 0;
  let attemptedNonInteractiveSshRegistration = false;

  for (;;) {
    const state = await evaluateDigitalOceanReadiness(agentName);

    const jsonReadiness =
      process.env.SPAWN_NON_INTERACTIVE === "1" &&
      (process.argv.includes("--json-readiness") || process.env.SPAWN_JSON_READINESS === "1");
    if (!jsonReadiness) {
      renderReadinessChecklist(state);
    }

    if (state.status === "READY") {
      break;
    }

    if (process.env.SPAWN_NON_INTERACTIVE === "1") {
      const firstBlocker = state.blockers[0];
      if (firstBlocker === "ssh_missing" && !attemptedNonInteractiveSshRegistration) {
        attemptedNonInteractiveSshRegistration = true;
        logAlwaysStep("Registering Spawn SSH key with DigitalOcean (non-interactive)...");
        await ensureSshKey();
        continue;
      }

      if (jsonReadiness) {
        console.log(JSON.stringify(state));
      } else {
        logError(`DigitalOcean readiness blocked: ${state.blockers.join(", ")}`);
        logAlwaysInfo(`Billing: ${DIGITALOCEAN_BILLING_ADD_PAYMENT_URL}`);
        if (attemptedNonInteractiveSshRegistration && state.blockers.includes("ssh_missing")) {
          const pubPath = getSpawnKey().pubPath;
          logAlwaysInfo(
            "SSH key registration did not succeed (try adding a payment method in DigitalOcean, or add this public key manually under Account → Security → SSH Keys):",
          );
          logAlwaysInfo(`  ${pubPath}`);
        }
      }
      process.exit(1);
    }

    const first = state.blockers[0];
    if (!first) {
      break;
    }

    if (first === previousTopBlocker) {
      sameTopBlockerRepeats++;
    } else {
      sameTopBlockerRepeats = 0;
    }
    previousTopBlocker = first;

    if (sameTopBlockerRepeats >= 2) {
      logError(
        "Readiness is still blocked after several attempts. " +
          "If DigitalOcean rejected SSH key upload, add a payment method first or register your public key in Account → Security.",
      );
      logAlwaysInfo(`Billing: ${DIGITALOCEAN_BILLING_ADD_PAYMENT_URL}`);
      await prompt("Press Enter after you've addressed this to re-check...");
      sameTopBlockerRepeats = 0;
    }

    if (first !== "do_auth") {
      p.log.warn(`Blocked: ${first.replace(/_/g, " ")}`);
    }
    await resolveFirstBlocker(first, agentName);
  }

  await ensureSshKey();
  if (!process.env.THEGRID_API_KEY) {
    const saved = loadSavedTheGridApiKey();
    if (saved && (await verifyTheGridApiKey(saved))) {
      process.env.THEGRID_API_KEY = saved;
    }
  }
  await getOrPromptApiKey(agentName, "digitalocean");
}
