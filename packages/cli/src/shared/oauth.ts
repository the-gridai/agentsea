// shared/oauth.ts — The Grid API key handling (manual entry; OAuth TBD).
//
// Enterprise / automation: there is no browser OAuth for The Grid in this CLI yet.
// Use a key issued from your The Grid organization (or CI secret) and set THEGRID_API_KEY,
// or persist via ~/.config/agentsea/thegrid.json after a successful run.
// For SSO-backed orgs, follow your internal docs for API key issuance until first-party
// OAuth is wired here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getErrorMessage, isString } from "@agentsea/sdk";
import { parseJsonObj } from "./parse.js";
import { gridInferenceModelsUrl } from "./grid-api.js";
import { getAgentseaCloudConfigPath } from "./paths.js";
import { asyncTryCatchIf, isFileError, isNetworkError, tryCatch } from "./result.js";
import { logDebug, logError, logInfo, logWarn, logAlwaysInfo, prompt, retryOrQuit } from "./ui.js";
import { LEGACY_SAVED_API_KEY_CONFIG_STEM } from "./vendor-routing.js";

/** AgentSea uses The Grid inference (`GET /v1/models`, chat) — consumption keys, not trading keys. */
export const GRID_CONSUMPTION_API_KEY_PROMPT_LABEL =
  "Paste your Grid consumption API key (not trading):";
export const GRID_CONSUMPTION_API_KEY_HINT =
  "Create a consumption API key at https://app.thegrid.ai — not a trading key.";

// ─── Key Validation ──────────────────────────────────────────────────────────

/** Validate THEGRID_API_KEY via Grid `GET /v1/models` (best-effort; skips on network errors). */
export async function verifyTheGridApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) {
    return false;
  }
  if (
    process.env.AGENTSEA_SKIP_API_VALIDATION ||
    process.env.BUN_ENV === "test" ||
    process.env.NODE_ENV === "test"
  ) {
    return true;
  }

  const result = await asyncTryCatchIf(isNetworkError, async () => {
    // Use the OpenAI-compatible models list — it returns 200 when the key is valid.
    // (`/auth/key` has been observed to 404 on production; models is the stable probe.)
    const resp = await fetch(gridInferenceModelsUrl(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 200) {
      return true;
    }
    if (resp.status === 401 || resp.status === 403) {
      logError("The Grid consumption API key is invalid or expired");
      logError("Trading keys cannot be used here — create a consumption key instead.");
      logError(GRID_CONSUMPTION_API_KEY_HINT);
      return false;
    }
    return true; // unknown status = don't block
  });
  return result.ok ? result.data : true; // network error = skip validation
}

// ─── PKCE (S256) ────────────────────────────────────────────────────────────

/** Base64url-encode a Uint8Array (RFC 7636 Appendix A). */
function base64UrlEncode(bytes: Uint8Array): string {
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a cryptographically random code verifier (43 chars, URL-safe). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Derive the S256 code challenge: BASE64URL(SHA-256(verifier)). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return base64UrlEncode(digest);
}

// ─── OAuth Flow via Bun.serve ────────────────────────────────────────────────

export function generateCsrfState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const OAUTH_CSS =
  "*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff;color:#090a0b}@media(prefers-color-scheme:dark){body{background:#090a0b;color:#fafafa}}.card{text-align:center;max-width:400px;padding:2rem}.icon{font-size:2.5rem;margin-bottom:1rem}h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}p{font-size:.875rem;color:#6b7280}@media(prefers-color-scheme:dark){p{color:#9ca3af}}";

async function tryOauthFlow(callbackPort = 5180, agentSlug?: string, cloudSlug?: string): Promise<string | null> {
  void callbackPort;
  void agentSlug;
  void cloudSlug;
  logAlwaysInfo(`${GRID_CONSUMPTION_API_KEY_HINT} Paste it below — browser OAuth for The Grid is not wired in this CLI yet.`);
  return null;
}

// ─── API Key Persistence ─────────────────────────────────────────────────────

/** Save THEGRID_API_KEY for reuse (optional gated by setup steps). */
async function saveTheGridApiKey(key: string): Promise<void> {
  const result = await asyncTryCatchIf(isFileError, async () => {
    const configPath = getAgentseaCloudConfigPath("thegrid");
    mkdirSync(dirname(configPath), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          api_key: key,
        },
        null,
        2,
      ) + "\n",
      {
        mode: 0o600,
      },
    );
  });
  if (!result.ok) {
    logWarn("Could not save API key — you may need to re-authenticate next run");
    logDebug(getErrorMessage(result.error));
  }
}

/** Check whether a saved Grid API key exists (without loading it). */
export function hasSavedTheGridKey(): boolean {
  return loadSavedTheGridApiKey() !== null;
}

/** Load a saved THEGRID_API key (alternate config filename from early releases still supported). */
export function loadSavedTheGridApiKey(): string | null {
  for (const slug of ["thegrid", LEGACY_SAVED_API_KEY_CONFIG_STEM]) {
    const result = tryCatch(() => {
      const configPath = getAgentseaCloudConfigPath(slug);
      const data = parseJsonObj(readFileSync(configPath, "utf-8"));
      if (!data) {
        return null;
      }
      const key = isString(data.api_key) ? data.api_key : "";
      if (key.trim().length >= 8) {
        return key;
      }
      return null;
    });
    if (result.ok && result.data) {
      return result.data;
    }
  }
  return null;
}

// ─── Main API Key Acquisition ────────────────────────────────────────────────

async function promptAndValidateApiKey(): Promise<string | null> {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const key = await prompt(GRID_CONSUMPTION_API_KEY_PROMPT_LABEL);
    if (!key) {
      logError("API key cannot be empty");
      continue;
    }
    // Validate format
    if (key.trim().length < 8) {
      logWarn("Grid API keys are usually longer — double-check formatting.");
      const confirm = await prompt("Use this key anyway? (y/N): ");
      if (!/^[Yy]$/.test(confirm)) {
        continue;
      }
    }
    return key;
  }
  logError("Too many failed attempts.");
  logError(GRID_CONSUMPTION_API_KEY_HINT);
  return null;
}

export async function getOrPromptApiKey(agentSlug?: string, cloudSlug?: string): Promise<string> {
  process.stderr.write("\n");

  // 1. Check env var
  if (process.env.THEGRID_API_KEY) {
    logAlwaysInfo("Using Grid API key from environment");
    if (await verifyTheGridApiKey(process.env.THEGRID_API_KEY)) {
      return process.env.THEGRID_API_KEY;
    }
    logWarn("Environment key failed validation, prompting for a new one...");
    delete process.env.THEGRID_API_KEY;
  }

  // 2. Check saved key from a previous run (unless forcing re-auth via --reauth).
  if (process.env.AGENTSEA_REAUTH !== "1") {
    const savedKey = loadSavedTheGridApiKey();
    if (savedKey) {
      logAlwaysInfo("Using saved Grid API key");
      if (await verifyTheGridApiKey(savedKey)) {
        process.env.THEGRID_API_KEY = savedKey;
        return savedKey;
      }
      logWarn("Saved key failed validation, prompting for a new one...");
    }
  }

  // 3. Try OAuth + manual fallback (retry loop — never exits unless user says no)
  for (;;) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Try OAuth first
      const key = await tryOauthFlow(5180, agentSlug, cloudSlug);
      if (key && (await verifyTheGridApiKey(key))) {
        process.env.THEGRID_API_KEY = key;
        await saveTheGridApiKey(key);
        return key;
      }

      // OAuth failed — fall through to manual entry
      process.stderr.write("\n");
      logWarn("Browser-based login was not completed.");
      logAlwaysInfo(GRID_CONSUMPTION_API_KEY_HINT);
      process.stderr.write("\n");

      const manualKey = await promptAndValidateApiKey();
      if (manualKey && (await verifyTheGridApiKey(manualKey))) {
        process.env.THEGRID_API_KEY = manualKey;
        await saveTheGridApiKey(manualKey);
        return manualKey;
      }
    }

    logError("No valid API key after 3 attempts");
    await retryOrQuit("Try getting an API key again?");
  }
}
