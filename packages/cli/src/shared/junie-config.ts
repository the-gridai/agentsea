// junie-config.ts ? Junie-only BYOK wiring for The Grid (OpenAI-compatible custom profile).
// Writes only under ~/.junie/; does not touch other agents' config trees.
//
// Junie cannot call https://api.thegrid.ai/v1/chat/completions directly — 307 redirects break its HTTP client.
// Local grid-chat-proxy on :4143 follows redirects upstream.

import type { CloudRunner } from "./agent-setup.js";
import { uploadConfigFile } from "./agent-setup.js";
import { resolveAgentGridModelId } from "./grid-instruments.js";
import { DEFAULT_GRID_INFERENCE_API_BASE } from "./grid-api.js";
import { deployGridChatProxy, gridChatProxyCompletionsUrl, startGridChatProxy } from "./grid-chat-proxy.js";
import { logInfo, logStep, validateModelId } from "./ui.js";

/** Upstream Grid inference API (proxied with redirect follow). */
export const JUNIE_GRID_UPSTREAM_BASE = DEFAULT_GRID_INFERENCE_API_BASE;

/** Local redirect-following proxy port — Junie-only. */
export const JUNIE_GRID_CHAT_PROXY_PORT = 4143;

/** Junie custom profile baseUrl — full chat/completions URL (Junie POSTs to baseUrl verbatim). */
export const JUNIE_GRID_CHAT_URL = gridChatProxyCompletionsUrl(JUNIE_GRID_CHAT_PROXY_PORT);

/** @deprecated Use JUNIE_GRID_CHAT_URL in Junie profiles. */
export const JUNIE_GRID_API_BASE = JUNIE_GRID_CHAT_URL;

/** Filename stem for ~/.junie/models/<id>.json ? referenced as custom:<id> on the CLI. */
export const JUNIE_GRID_PROFILE_ID = "thegrid";

/** Default Junie `--model` / `JUNIE_MODEL` when using the Grid profile above. */
export const JUNIE_GRID_CUSTOM_MODEL = `custom:${JUNIE_GRID_PROFILE_ID}`;

export const JUNIE_LAUNCH_SHELL_PREFIX = [
  "source ~/.agentsearc 2>/dev/null",
  "source ~/.zshrc 2>/dev/null",
  `export JUNIE_MODEL=${JUNIE_GRID_CUSTOM_MODEL}`,
].join("; ");

export function resolveJunieGridModelId(modelId?: string): string {
  if (typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())) {
    return modelId.trim();
  }
  return resolveAgentGridModelId("junie");
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
    baseUrl: JUNIE_GRID_CHAT_URL,
    id,
    apiType: "OpenAICompletion",
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

  await runner.runServer("mkdir -p ~/.junie/models");
  await deployGridChatProxy(runner, { scriptPath: "~/.junie/grid-chat-proxy.mjs" });
  await uploadConfigFile(
    runner,
    `${JSON.stringify(modelProfile, null, 2)}\n`,
    "$HOME/.junie/models/thegrid.json",
  );
  await uploadConfigFile(runner, `${JSON.stringify(config, null, 2)}\n`, "$HOME/.junie/config.json");
  await runner.runServer(
    "chmod 600 ~/.junie/grid-chat-proxy.mjs ~/.junie/models/thegrid.json ~/.junie/config.json",
  );

  logInfo(
    `Junie configured (${JUNIE_GRID_CUSTOM_MODEL} → local :${JUNIE_GRID_CHAT_PROXY_PORT} → ${selectedModel} @ ${JUNIE_GRID_UPSTREAM_BASE})`,
  );
}

/** Start Junie redirect-following chat proxy before interactive/headless launch. */
export async function startJunieGridChatProxy(runner: CloudRunner): Promise<void> {
  await startGridChatProxy(runner, {
    name: "Junie",
    port: JUNIE_GRID_CHAT_PROXY_PORT,
    scriptPath: "~/.junie/grid-chat-proxy.mjs",
    logPath: "/tmp/junie-grid-chat-proxy.log",
    wrapperName: "junie-grid-chat-proxy",
  });
}
