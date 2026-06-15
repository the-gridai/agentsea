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
import { readHiddenLineFromTTY } from "../picker.js";
import { gridInferenceModelsUrl, resolveGridWebAppOrigin } from "./grid-api.js";
import { getAgentseaCloudConfigPath } from "./paths.js";
import { asyncTryCatchIf, isFileError, isNetworkError, tryCatch } from "./result.js";
import {
  logDebug,
  logError,
  logWarn,
  logAlwaysInfo,
  logAlwaysStep,
  openBrowser,
  prepareStdinForClack,
  resetStderrAttributes,
  retryOrQuit,
  runWithSpinner,
} from "./ui.js";
import { LEGACY_SAVED_API_KEY_CONFIG_STEM } from "./vendor-routing.js";

/** AgentSea uses The Grid inference (`GET /v1/models`, chat) — consumption keys, not trading keys. */
export const GRID_CONSUMPTION_API_KEY_PROMPT_LABEL = "Grid API key:";
export const GRID_CONSUMPTION_API_KEY_HINT =
  "Create a consumption API key at https://app.thegrid.ai — not a trading key.";

// ─── Key Validation ──────────────────────────────────────────────────────────

/** OpenRouter-compatible consumption keys from The Grid app (`sk-or-v1-` + hex). */
const GRID_OPENROUTER_CONSUMPTION_PATTERN = /^sk-or-v1-[a-f0-9]{32,}$/;

/** Base64 consumption keys from app.thegrid.ai (same shape as some trading keys — use network validation). */
const GRID_BASE64_CONSUMPTION_PATTERN = /^[A-Za-z0-9+/]{32,}={0,2}$/;

function isGridConsumptionKeyShape(key: string): boolean {
  return GRID_OPENROUTER_CONSUMPTION_PATTERN.test(key) || GRID_BASE64_CONSUMPTION_PATTERN.test(key);
}

const GRID_API_KEY_PLACEHOLDER =
  /^(?:test|xxx+|changeme|placeholder|example|fake|dummy|none|null|undefined|your[-_]?api[-_]?key)$/i;

const GRID_API_KEY_PLACEHOLDER_FRAGMENT =
  /(?:xxxxx|your[-_]?key(?:[-_]?here)?|insert[-_]?key|api[-_]?key[-_]?here|paste[-_]?key)/i;

export type GridApiKeyFormatResult = { valid: true } | { valid: false; message: string };

/** Local format check — no network I/O. Rejects empty, placeholders, and malformed prefixes. */
export function validateGridConsumptionApiKeyFormat(raw: string): GridApiKeyFormatResult {
  const key = raw.trim();
  if (!key) {
    return { valid: false, message: "API key cannot be empty" };
  }
  if (raw !== key || /\s/.test(raw)) {
    return {
      valid: false,
      message: "API key must not contain leading, trailing, or internal whitespace",
    };
  }
  if (GRID_API_KEY_PLACEHOLDER.test(key) || GRID_API_KEY_PLACEHOLDER_FRAGMENT.test(key)) {
    return {
      valid: false,
      message: "That looks like a placeholder — paste your real consumption key from The Grid app",
    };
  }
  if (/^sk-(?!or-v1-)/.test(key)) {
    return {
      valid: false,
      message: "That key prefix is not a Grid consumption key — use a key from https://app.thegrid.ai",
    };
  }
  if (!isGridConsumptionKeyShape(key)) {
    return {
      valid: false,
      message:
        "Invalid format — paste your consumption API key from https://app.thegrid.ai (sk-or-v1-… or the base64 key shown in the app)",
    };
  }
  return { valid: true };
}

const GRID_API_KEY_VALIDATION_TTL_MS = 60_000;

type GridApiKeyValidationCache = {
  keyHash: string;
  validatedAt: number;
};

let gridApiKeyValidationCache: GridApiKeyValidationCache | null = null;

/** Override fetch for cache tests (Bun CI may not honor global.fetch mocks). */
let gridApiKeyValidationFetchOverride: typeof fetch | undefined;

/** @internal tests only */
export function setGridApiKeyValidationFetchForTests(fetchFn: typeof fetch | undefined): void {
  gridApiKeyValidationFetchOverride = fetchFn;
}

function gridApiKeyValidationFetch(): typeof fetch {
  return gridApiKeyValidationFetchOverride ?? fetch;
}

async function hashGridApiKey(apiKey: string): Promise<string> {
  const encoded = new TextEncoder().encode(apiKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Clear the in-process validation cache (tests only). */
export function resetGridApiKeyValidationCacheForTests(): void {
  gridApiKeyValidationCache = null;
}

/** Validate THEGRID_API_KEY via Grid `GET /v1/models` (best-effort; skips on network errors). */
export async function verifyTheGridApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) {
    return false;
  }
  const format = validateGridConsumptionApiKeyFormat(apiKey);
  if (!format.valid) {
    logWarn(format.message);
    return false;
  }
  if (process.env.AGENTSEA_SKIP_API_VALIDATION === "1") {
    return true;
  }

  const keyHash = await hashGridApiKey(apiKey);
  if (
    gridApiKeyValidationCache &&
    gridApiKeyValidationCache.keyHash === keyHash &&
    Date.now() - gridApiKeyValidationCache.validatedAt < GRID_API_KEY_VALIDATION_TTL_MS
  ) {
    return true;
  }

  const result = await runWithSpinner("Validating Grid API key…", async () =>
    asyncTryCatchIf(isNetworkError, async () => {
      // Use the OpenAI-compatible models list — it returns 200 when the key is valid.
      // (`/auth/key` has been observed to 404 on production; models is the stable probe.)
      const resp = await gridApiKeyValidationFetch()(gridInferenceModelsUrl(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.status === 200) {
        return true;
      }
      if (resp.status === 401 || resp.status === 403) {
        logWarn("Invalid or expired Grid API key — use a consumption key (not trading) from The Grid app.");
        return false;
      }
      return true; // unknown status = don't block
    }),
  );
  const valid = result.ok ? result.data : true; // network error = skip validation
  if (result.ok && result.data) {
    gridApiKeyValidationCache = {
      keyHash,
      validatedAt: Date.now(),
    };
  }
  return valid;
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
      if (validateGridConsumptionApiKeyFormat(key).valid) {
        return key.trim();
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

function showApiKeyIntro(): void {
  logAlwaysStep("Create a consumption API key (not a trading key) in The Grid app.");
  const gridAppUrl = resolveGridWebAppOrigin();
  if (process.env.AGENTSEA_NON_INTERACTIVE === "1" || process.env.AGENTSEA_OPEN_GRID_APP === "0") {
    logAlwaysStep(`Open ${gridAppUrl} to create a key.`);
    return;
  }
  logAlwaysStep(`Opening ${gridAppUrl} …`);
  openBrowser(gridAppUrl);
}

/**
 * Max time to wait for the user to enter a key before bailing out with guidance.
 * A hard ceiling guarantees the CLI can never hang indefinitely at this prompt
 * (the macOS/Bun TTY symptom reported in the field). Override for slow pasters.
 */
const KEY_PROMPT_TIMEOUT_MS = Number(process.env.AGENTSEA_KEY_PROMPT_TIMEOUT_MS) || 300_000;

/** Best-effort local-echo toggle via `stty` (POSIX TTYs only). Returns true if echo was disabled. */
function setTerminalEcho(enabled: boolean): boolean {
  if (process.platform === "win32") {
    return false;
  }
  const r = tryCatch(() =>
    Bun.spawnSync(["stty", enabled ? "echo" : "-echo"], {
      stdio: ["inherit", "inherit", "inherit"],
    }),
  );
  return r.ok && r.data.exitCode === 0;
}

/**
 * Read one line of input with the key hidden, WITHOUT relying on Clack's raw-mode
 * keypress reader.
 *
 * We stay in cooked/canonical mode and mask via `stty -echo` (the classic Unix
 * password behavior). This is robust against the macOS + Bun TTY quirk where the
 * stdin stream is not resumed after a spinner/`spawnSync`, which left Clack's
 * raw-mode prompt unable to receive a paste (and Ctrl-C dead, since Clack reads
 * Ctrl-C as a keypress rather than SIGINT).
 *
 * Guarantees:
 * - Paste + Enter works (the line discipline buffers and delivers on newline).
 * - Ctrl-C always aborts (cooked mode delivers SIGINT, not a swallowed byte).
 * - A hard timeout means it can never hang forever.
 */
/** Bracketed-paste wrappers some terminals (macOS Terminal/iTerm) inject around pasted text. */
const BRACKETED_PASTE_MARKERS = /\x1b\[20[01]~/g;

/** Disable/enable terminal bracketed-paste mode so pasted keys don't arrive wrapped in escapes. */
function setBracketedPaste(enabled: boolean): void {
  if (process.stderr.isTTY) {
    process.stderr.write(enabled ? "\x1b[?2004h" : "\x1b[?2004l");
  }
}

export async function readHiddenLine(): Promise<string | null> {
  // Primary: read straight from /dev/tty. process.stdin can be unreadable when
  // the installer reattaches stdin via `exec 0</dev/tty` (curl | bash) on
  // macOS/Bun, which froze this prompt. /dev/tty reading is reliable there.
  const tty = readHiddenLineFromTTY();
  if (!tty.ttyUnavailable) {
    process.stderr.write("\n");
    if (tty.cancelled) {
      process.exit(130);
    }
    return tty.value;
  }

  // Fallback: process.stdin cooked reader (e.g. piped input / no controlling tty).
  const stdin = process.stdin;
  const isTty = Boolean(stdin.isTTY);

  // Undo any pause / raw mode / stale listeners left by earlier spinners or the
  // in-process handoff so the stream actually flows here.
  stdin.removeAllListeners("data");
  if (isTty) {
    tryCatch(() => stdin.setRawMode(false));
  }
  stdin.resume();
  stdin.setEncoding("utf8");

  // Turn off bracketed paste so a pasted key isn't surrounded by ESC[200~ / ESC[201~
  // (which would corrupt the key and fail validation). We also strip them defensively.
  setBracketedPaste(false);
  const echoDisabled = isTty ? setTerminalEcho(false) : false;

  return await new Promise<string | null>((resolve) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      process.removeListener("SIGINT", onSigint);
      if (echoDisabled) {
        setTerminalEcho(true);
      }
      stdin.pause();
    };

    const settle = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      process.stderr.write("\n");
      resolve(value === null ? null : value.replace(BRACKETED_PASTE_MARKERS, ""));
    };

    const onData = (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.search(/[\r\n]/);
      if (newlineIndex !== -1) {
        settle(buffer.slice(0, newlineIndex));
      }
    };

    const onSigint = () => {
      cleanup();
      process.stderr.write("\n");
      process.exit(130);
    };

    const timer = setTimeout(() => {
      logError(
        `No input received in ${Math.round(KEY_PROMPT_TIMEOUT_MS / 1000)}s. ` +
          "Set THEGRID_API_KEY=<your consumption key> and re-run, then try again.",
      );
      settle(null);
    }, KEY_PROMPT_TIMEOUT_MS);

    process.on("SIGINT", onSigint);
    stdin.on("data", onData);
  });
}

async function promptApiKey(): Promise<string | null> {
  resetStderrAttributes();
  prepareStdinForClack();
  logAlwaysStep("Paste your consumption API key from app.thegrid.ai, then press Enter (input is hidden).");
  process.stderr.write(`${GRID_CONSUMPTION_API_KEY_PROMPT_LABEL} `);

  const line = await readHiddenLine();
  if (line === null) {
    return null;
  }
  const trimmed = line.trim();
  const format = validateGridConsumptionApiKeyFormat(trimmed);
  if (!format.valid) {
    logError(format.message);
    return null;
  }
  return trimmed;
}

export async function getOrPromptApiKey(agentSlug?: string, cloudSlug?: string): Promise<string> {
  void agentSlug;
  void cloudSlug;

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

  // 3. Manual entry (retry loop — never exits unless user says no)
  for (;;) {
    showApiKeyIntro();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const manualKey = await promptApiKey();
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
