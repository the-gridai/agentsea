// Headless one-shot commands for E2E and `agentsea run --prompt`.

import { HERMES_GRID_CUSTOM_PROVIDER } from "./grid-api.js";
import { shellQuote } from "./ui.js";
import { KILO_GRID_PROVIDER_ID, OPENCLAW_GRID_PROVIDER_ID } from "./vendor-routing.js";
import { JUNIE_LAUNCH_SHELL_PREFIX } from "./junie-config.js";

const AGENTSEARC = "source ~/.agentsearc 2>/dev/null";

const NPM_PATH =
  "export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH";

/** Shell prefix for OpenCode launch/headless: agentsearc + zshrc + ~/.opencode/bin on PATH. */
export const OPENCODE_LAUNCH_SHELL_PREFIX =
  `${AGENTSEARC}; source ~/.zshrc 2>/dev/null; export PATH=$HOME/.opencode/bin:$HOME/.local/bin:$PATH`;

const HERMES_PATH =
  `${AGENTSEARC}; export PATH=$HOME/.local/bin:$HOME/.hermes/hermes-agent/venv/bin:$PATH`;

/** Stable session key for OpenClaw headless/E2E runs (matches sh/e2e/lib/verify.sh). */
export const OPENCLAW_HEADLESS_SESSION_KEY = "agentsea-e2e";

export function openclawHeadlessPrompt(prompt: string): string {
  return [
    AGENTSEARC,
    NPM_PATH,
    `openclaw agent --agent main --session-key ${shellQuote(OPENCLAW_HEADLESS_SESSION_KEY)}`,
    `--message ${shellQuote(prompt)}`,
    "--timeout 240 --json",
  ].join(" ");
}

export function opencodeHeadlessPrompt(prompt: string, modelId: string): string {
  return `${OPENCODE_LAUNCH_SHELL_PREFIX}; opencode run --dir "$PWD" --model ${shellQuote(`${OPENCLAW_GRID_PROVIDER_ID}/${modelId}`)} --dangerously-skip-permissions ${shellQuote(prompt)}`;
}

export function piHeadlessPrompt(prompt: string, modelId: string): string {
  return [
    AGENTSEARC,
    "source ~/.zshrc 2>/dev/null",
    `pi --print --provider ${OPENCLAW_GRID_PROVIDER_ID}`,
    `--model ${shellQuote(modelId)} --no-session`,
    shellQuote(prompt),
  ].join(" ");
}

export function junieHeadlessPrompt(prompt: string): string {
  return [
    JUNIE_LAUNCH_SHELL_PREFIX,
    'junie --project "$PWD"',
    `--task ${shellQuote(prompt)}`,
    "--timeout 240000 --skip-update-check",
  ].join(" ");
}

export function hermesHeadlessPrompt(prompt: string, modelId: string): string {
  return [
    HERMES_PATH,
    `hermes -z ${shellQuote(prompt)}`,
    `--provider ${HERMES_GRID_CUSTOM_PROVIDER}`,
    `-m ${shellQuote(modelId)}`,
    "--yolo",
  ].join(" ");
}

/** Cursor headless: --print enables tools; --trust/--force/--sandbox disabled avoid prompts. */
export function cursorHeadlessPrompt(prompt: string): string {
  return [
    AGENTSEARC,
    'export PATH="$HOME/.local/bin:$PATH"',
    "agent --endpoint https://api2.cursor.sh",
    "--print --trust --force --sandbox disabled",
    '--workspace "$HOME"',
    '--model "$GRID_MODEL_ID"',
    shellQuote(prompt),
  ].join(" ");
}

export function kilocodeHeadlessPrompt(prompt: string, modelId: string): string {
  return [
    AGENTSEARC,
    "source ~/.zshrc 2>/dev/null",
    `kilocode run --model ${shellQuote(`${KILO_GRID_PROVIDER_ID}/${modelId}`)}`,
    shellQuote(prompt),
  ].join(" ");
}

/** Tool E2E: agent must write this file via tools (not chat-only). Keep in sync with sh/e2e/lib/verify.sh */
export const TOOL_E2E_FILE = "/tmp/agentsea-e2e-tool.txt";
export const TOOL_E2E_MARKER = "TOOL_E2E_OK";

export function toolE2ePrompt(): string {
  return `Use your file or shell tools to create the absolute path file ${TOOL_E2E_FILE} containing exactly one line: ${TOOL_E2E_MARKER}. You must write the file on disk — a chat reply alone is not sufficient.`;
}

export function assertToolE2eFileCmd(): string {
  return `test -f ${TOOL_E2E_FILE} && grep -qFx '${TOOL_E2E_MARKER}' ${TOOL_E2E_FILE}`;
}

const HEADLESS_PROMPT_LOG = "/tmp/agentsea-headless-prompt.log";

/** Shell checks for Kilo headless output (#40 — exit 0 on gateway/model errors). */
function kilocodeOutputValidationShell(): string[] {
  return [
    `if grep -qiE 'model not found|unauthorized|payment required|\\b401\\b|\\b402\\b' ${HEADLESS_PROMPT_LOG} 2>/dev/null; then`,
    '  echo "AGENTSEA_PROMPT_FAILED: kilocode inference error in output" >&2',
    `  tail -40 ${HEADLESS_PROMPT_LOG} >&2 || true`,
    "  exit 1",
    "fi",
    `if ! grep -q '[^[:space:]]' ${HEADLESS_PROMPT_LOG} 2>/dev/null; then`,
    '  echo "AGENTSEA_PROMPT_FAILED: kilocode produced no output" >&2',
    "  exit 1",
    "fi",
  ];
}

/** Shell checks for OpenClaw `--json` headless output (winner routed via The Grid). */
function openclawJsonValidationShell(): string[] {
  return [
    `if grep -q 'winnerProvider' ${HEADLESS_PROMPT_LOG} 2>/dev/null; then`,
    `  if ! grep -qE '"winnerProvider"[[:space:]]*:[[:space:]]*"thegrid"' ${HEADLESS_PROMPT_LOG}; then`,
    '    echo "AGENTSEA_PROMPT_FAILED: openclaw JSON missing winnerProvider thegrid" >&2',
    `    tail -40 ${HEADLESS_PROMPT_LOG} >&2 || true`,
    "    exit 1",
    "  fi",
    `  if ! grep -qE '"winnerModel"[[:space:]]*:[[:space:]]*"' ${HEADLESS_PROMPT_LOG}; then`,
    '    echo "AGENTSEA_PROMPT_FAILED: openclaw JSON missing winnerModel" >&2',
    `    tail -40 ${HEADLESS_PROMPT_LOG} >&2 || true`,
    "    exit 1",
    "  fi",
    "fi",
  ];
}

/** Wrap a headless prompt command with output checks (#40 — fail on proxy/gateway errors). */
export function wrapHeadlessPromptCmd(innerCmd: string): string {
  const lines = [
    `(${innerCmd}) > ${HEADLESS_PROMPT_LOG} 2>&1`,
    "ec=$?",
    `if grep -qiE 'forbidden|gateway|proxy' ${HEADLESS_PROMPT_LOG} 2>/dev/null; then`,
    '  echo "AGENTSEA_PROMPT_FAILED: inference or proxy error in output" >&2',
    `  tail -40 ${HEADLESS_PROMPT_LOG} >&2 || true`,
    "  exit 1",
    "fi",
  ];
  if (innerCmd.includes("kilocode run")) {
    lines.push(...kilocodeOutputValidationShell());
  }
  if (innerCmd.includes("openclaw agent") && innerCmd.includes("--json")) {
    lines.push(...openclawJsonValidationShell());
  }
  lines.push(`cat ${HEADLESS_PROMPT_LOG}`, "exit $ec");
  return lines.join("\n");
}
