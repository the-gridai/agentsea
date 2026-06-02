// junie-config.ts ? Junie-only BYOK wiring for The Grid (OpenAI-compatible custom profile).
// Writes only under ~/.junie/; does not touch other agents' config trees.
//
// Junie cannot call https://api.thegrid.ai/v1/chat/completions directly ? that endpoint 307-redirects
// to synapse.thegrid.ai and Junie surfaces the HTML redirect as "OpenAI: 403 Forbidden".
// Same fix as Hermes/Codex: local LiteLLM on :4143 follows the redirect upstream.

import type { CloudRunner } from "./agent-setup.js";
import {
  LITELLM_VENV_SETUP,
  startLiteLlmProxyLocally,
  uploadConfigFile,
  validateScriptTemplate,
} from "./agent-setup.js";
import { asyncTryCatch } from "./result.js";
import { DEFAULT_GRID_INFERENCE_API_BASE, resolveGridInferenceApiBase } from "./grid-api.js";
import { logInfo, logStep, validateModelId } from "./ui.js";
import { GRID_INFERENCE_DEFAULT_MODEL_ID } from "./vendor-routing.js";

/** Upstream Grid inference API (used only by ~/.junie/litellm.yaml ? not Junie's baseUrl). */
export const JUNIE_GRID_UPSTREAM_BASE = DEFAULT_GRID_INFERENCE_API_BASE;

/** Local LiteLLM proxy port ? Junie-only; does not collide with Codex (:4141) or Hermes (:4142). */
export const JUNIE_LITELLM_PORT = 4143;

/** Junie custom profile baseUrl ? full chat/completions URL (Junie POSTs to baseUrl verbatim). */
export const JUNIE_LITELLM_CHAT_URL = `http://127.0.0.1:${JUNIE_LITELLM_PORT}/v1/chat/completions`;

/** LiteLLM listen prefix (health checks only ? not used as Junie baseUrl). */
export const JUNIE_LITELLM_BASE_URL = `http://127.0.0.1:${JUNIE_LITELLM_PORT}/v1`;

/** @deprecated Use JUNIE_LITELLM_CHAT_URL in Junie profiles. */
export const JUNIE_GRID_API_BASE = JUNIE_LITELLM_CHAT_URL;

/** Filename stem for ~/.junie/models/<id>.json ? referenced as custom:<id> on the CLI. */
export const JUNIE_GRID_PROFILE_ID = "thegrid";

/** Default Junie `--model` / `JUNIE_MODEL` when using the Grid profile above. */
export const JUNIE_GRID_CUSTOM_MODEL = `custom:${JUNIE_GRID_PROFILE_ID}`;

const JUNIE_LITELLM_HEALTH_CHECK =
  `curl -sf "http://127.0.0.1:${JUNIE_LITELLM_PORT}/health/liveliness" >/dev/null 2>&1`;

export const JUNIE_LAUNCH_SHELL_PREFIX = [
  "source ~/.spawnrc 2>/dev/null",
  "source ~/.zshrc 2>/dev/null",
  `export JUNIE_MODEL=${JUNIE_GRID_CUSTOM_MODEL}`,
].join("; ");

export function resolveJunieGridModelId(modelId?: string): string {
  if (typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())) {
    return modelId.trim();
  }
  return GRID_INFERENCE_DEFAULT_MODEL_ID;
}

export function buildJunieLiteLlmYaml(modelId: string): string {
  const upstreamBase = resolveGridInferenceApiBase();
  const upstreamModel = modelId.includes("/") ? modelId : `openai/${modelId}`;
  return `model_list:
  - model_name: "${modelId}"
    litellm_params:
      model: "${upstreamModel}"
      api_base: "${upstreamBase}"
      api_key: "os.environ/THEGRID_API_KEY"
      use_chat_completions_api: true
      drop_params: true

litellm_settings:
  drop_params: true
`;
}

export function buildJunieGridModelProfile(
  apiKey: string,
  modelId?: string,
): {
  baseUrl: string;
  id: string;
  apiType: "OpenAICompletion";
  apiKey: string;
  fasterModel: { id: string };
} {
  const id = resolveJunieGridModelId(modelId);
  return {
    baseUrl: JUNIE_LITELLM_CHAT_URL,
    id,
    apiType: "OpenAICompletion",
    // Local LiteLLM accepts the key; upstream auth uses THEGRID_API_KEY from ~/.spawnrc in the wrapper.
    apiKey,
    // Without fasterModel, Junie falls back to built-in OpenAI models for helper tasks ? 403.
    fasterModel: { id },
  };
}

export function buildJunieGridConfig(): { model: string } {
  return {
    model: JUNIE_GRID_CUSTOM_MODEL,
  };
}

/**
 * Junie first-run auth reads ~/.junie/config.json and ~/.junie/models/*.json ? not JUNIE_THEGRID_API_KEY.
 * Without this, `junie` shows the JetBrains welcome / sign-in wizard on every fresh VM.
 */
export async function setupJunieConfig(
  runner: CloudRunner,
  apiKey: string,
  modelId?: string,
): Promise<void> {
  logStep("Configuring Junie for The Grid...");

  const selectedModel = resolveJunieGridModelId(modelId);
  const modelProfile = buildJunieGridModelProfile(apiKey, selectedModel);
  const config = buildJunieGridConfig();
  const litellmConfig = buildJunieLiteLlmYaml(selectedModel);

  await runner.runServer("mkdir -p ~/.junie/models");
  await uploadConfigFile(runner, `${litellmConfig}\n`, "$HOME/.junie/litellm.yaml");
  await uploadConfigFile(
    runner,
    `${JSON.stringify(modelProfile, null, 2)}\n`,
    "$HOME/.junie/models/thegrid.json",
  );
  await uploadConfigFile(runner, `${JSON.stringify(config, null, 2)}\n`, "$HOME/.junie/config.json");
  await runner.runServer(
    "chmod 600 ~/.junie/litellm.yaml ~/.junie/models/thegrid.json ~/.junie/config.json",
  );

  logStep("Installing Junie LiteLLM proxy (python3-venv + litellm)...");
  const venvResult = await asyncTryCatch(() => runner.runServer(LITELLM_VENV_SETUP, 300));
  if (!venvResult.ok) {
    throw new Error(
      "Junie LiteLLM install failed ? ensure python3-venv is available on the VM (see provisioning logs)",
    );
  }

  logInfo(
    `Junie configured (${JUNIE_GRID_CUSTOM_MODEL} ? local :${JUNIE_LITELLM_PORT} ? ${selectedModel} @ ${resolveGridInferenceApiBase()})`,
  );
}

/** Start Junie-only LiteLLM proxy before interactive/headless launch. */
export async function startJunieLiteLlmProxy(runner: CloudRunner): Promise<void> {
  logStep("Starting Junie local chat/completions proxy...");

  const wrapperScript = [
    "#!/bin/bash",
    'source "$HOME/.spawnrc" 2>/dev/null',
    'export PATH="$HOME/.local/bin:$HOME/.litellm-venv/bin:$PATH"',
    "export THEGRID_API_KEY",
    `exec "$HOME/.litellm-venv/bin/litellm" --config "$HOME/.junie/litellm.yaml" --host 127.0.0.1 --port ${JUNIE_LITELLM_PORT}`,
  ].join("\n");

  const unitFile = [
    "[Unit]",
    "Description=Junie LiteLLM proxy for The Grid",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/junie-litellm-wrapper",
    "Restart=always",
    "RestartSec=3",
    "User=__USER__",
    "Environment=HOME=__HOME__",
    "StandardOutput=append:/tmp/junie-litellm.log",
    "StandardError=append:/tmp/junie-litellm.log",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  validateScriptTemplate(wrapperScript, "junie-litellm-wrapper");
  validateScriptTemplate(unitFile, "junie-litellm-unit");

  const wrapperB64 = Buffer.from(wrapperScript).toString("base64");
  const unitB64 = Buffer.from(unitFile).toString("base64");

  const checkLines = [
    "source ~/.spawnrc 2>/dev/null",
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.litellm-venv/bin:$PATH"',
    'test -n "$THEGRID_API_KEY" || { echo "THEGRID_API_KEY missing from ~/.spawnrc" >&2; exit 1; }',
    "export THEGRID_API_KEY",
    'test -s "$HOME/.junie/litellm.yaml" || { echo "Missing ~/.junie/litellm.yaml" >&2; exit 1; }',
  ];
  const venvWrapperLines = [
    LITELLM_VENV_SETUP,
    'test -x "$HOME/.litellm-venv/bin/litellm" || { echo "litellm binary missing after venv setup" >&2; exit 1; }',
    "printf '%s' '" + wrapperB64 + "' | base64 -d > /tmp/junie-litellm-wrapper.tmp",
    "chmod +x /tmp/junie-litellm-wrapper.tmp",
  ];

  // Local mode: launch detached via runner.startService instead of the
  // in-shell `setsid ? &`, which Bun tears down (see startLiteLlmProxyLocally).
  if (runner.startService) {
    await startLiteLlmProxyLocally(runner, {
      name: "Junie",
      port: JUNIE_LITELLM_PORT,
      binName: "junie-litellm-wrapper",
      logPath: "/tmp/junie-litellm.log",
      healthCheck: JUNIE_LITELLM_HEALTH_CHECK,
      prepLines: [...checkLines, ...venvWrapperLines],
    });
    return;
  }

  const script = [
    ...checkLines,
    `if ${JUNIE_LITELLM_HEALTH_CHECK}; then echo "Junie proxy already running on :${JUNIE_LITELLM_PORT}"; exit 0; fi`,
    ...venvWrapperLines,
    "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then",
    '  _sudo=""',
    '  [ "$(id -u)" != "0" ] && _sudo="sudo"',
    "  $_sudo mv /tmp/junie-litellm-wrapper.tmp /usr/local/bin/junie-litellm-wrapper",
    "  printf '%s' '" + unitB64 + "' | base64 -d > /tmp/junie-litellm.unit.tmp",
    '  sed -i "s|__USER__|$(whoami)|;s|__HOME__|$HOME|" /tmp/junie-litellm.unit.tmp',
    "  $_sudo mv /tmp/junie-litellm.unit.tmp /etc/systemd/system/junie-litellm.service",
    "  $_sudo systemctl daemon-reload",
    "  $_sudo systemctl enable junie-litellm 2>/dev/null",
    "  $_sudo systemctl restart junie-litellm",
    "else",
    // No systemd (e.g. macOS local runs): /usr/local/bin is not user-writable
    // and we have no sudo here, so install the wrapper into the user-owned
    // ~/.local/bin (already on PATH above) instead.
    '  mkdir -p "$HOME/.local/bin"',
    '  mv /tmp/junie-litellm-wrapper.tmp "$HOME/.local/bin/junie-litellm-wrapper"',
    "  pkill -f '[j]unie-litellm-wrapper' 2>/dev/null || true",
    "  sleep 1",
    "  if command -v setsid >/dev/null 2>&1; then",
    '    setsid "$HOME/.local/bin/junie-litellm-wrapper" >> /tmp/junie-litellm.log 2>&1 < /dev/null &',
    "  else",
    '    nohup "$HOME/.local/bin/junie-litellm-wrapper" >> /tmp/junie-litellm.log 2>&1 < /dev/null &',
    "  fi",
    "fi",
    "elapsed=0; while [ $elapsed -lt 120 ]; do",
    `  if ${JUNIE_LITELLM_HEALTH_CHECK}; then echo "Junie proxy ready after $elapsed sec"; exit 0; fi`,
    "  printf '.'; sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Junie LiteLLM proxy failed to start after 120s"; tail -60 /tmp/junie-litellm.log 2>/dev/null; exit 1',
  ].join("\n");

  await runner.runServer(script, 180);
  logInfo(`Junie proxy started on :${JUNIE_LITELLM_PORT}`);
}
