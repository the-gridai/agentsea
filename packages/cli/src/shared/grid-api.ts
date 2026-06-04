/** Env var for overriding The Grid OpenAI-compatible inference API base (e.g. dev/staging). */
export const THEGRID_API_URL_ENV = "THEGRID_API_URL";

/** Production inference API base (`GET ù/models`, `POST ù/chat/completions`). */
export const DEFAULT_GRID_INFERENCE_API_BASE = "https://api.thegrid.ai/v1";

/** Trim trailing slashes from a Grid inference API base URL. */
export function normalizeGridInferenceApiBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Resolved inference API base. Uses `THEGRID_API_URL` when set, otherwise production.
 * Value should be the full OpenAI-compatible prefix (typically ending in `/v1`).
 */
export function resolveGridInferenceApiBase(): string {
  const override = process.env[THEGRID_API_URL_ENV]?.trim();
  if (!override) {
    return DEFAULT_GRID_INFERENCE_API_BASE;
  }
  return normalizeGridInferenceApiBase(override);
}

export function gridInferenceModelsUrl(): string {
  return `${resolveGridInferenceApiBase()}/models`;
}

export function gridInferenceChatCompletionsUrl(): string {
  return `${resolveGridInferenceApiBase()}/chat/completions`;
}

/** Optional `THEGRID_API_URL=ù` line for ~/.agentsearc when a local override is active. */
export function gridInferenceOverrideEnvLine(): string | undefined {
  const override = process.env[THEGRID_API_URL_ENV]?.trim();
  if (!override) {
    return undefined;
  }
  return `THEGRID_API_URL=${normalizeGridInferenceApiBase(override)}`;
}

/** Production Anthropic Messages client base (SDK appends `/v1/messages`). */
export const DEFAULT_GRID_ANTHROPIC_MESSAGES_CLIENT_BASE = "https://messages-beta.api.thegrid.ai";

/** Production OpenClaw / OpenAI-compat probe base (includes `/v1`). */
export const DEFAULT_GRID_OPENCLAW_MESSAGES_BASE = `${DEFAULT_GRID_ANTHROPIC_MESSAGES_CLIENT_BASE}/v1`;

/**
 * Anthropic Messages client base for Claude / OpenClaw (no trailing `/v1`).
 * Follows `THEGRID_API_URL` so dev keys hit `messages-beta.api.dev.thegrid.ai`.
 */
export function resolveGridAnthropicMessagesClientBase(): string {
  const base = resolveGridInferenceApiBase();
  if (base.includes("api.dev.thegrid.ai")) {
    return "https://messages-beta.api.dev.thegrid.ai";
  }
  if (base.includes("api.staging.thegrid.ai")) {
    return "https://messages-beta.api.staging.thegrid.ai";
  }
  return DEFAULT_GRID_ANTHROPIC_MESSAGES_CLIENT_BASE;
}

/** OpenClaw custom provider base URL (Anthropic-compatible, includes `/v1`). */
export function resolveGridOpenClawMessagesBase(): string {
  return `${resolveGridAnthropicMessagesClientBase()}/v1`;
}

/** The Grid web app origin for credits / account management (matches inference env). */
export function resolveGridWebAppOrigin(): string {
  const base = resolveGridInferenceApiBase();
  if (base.includes("api.dev.thegrid.ai")) {
    return "https://app.dev.thegrid.ai";
  }
  if (base.includes("api.staging.thegrid.ai")) {
    return "https://app.staging.thegrid.ai";
  }
  return "https://app.thegrid.ai";
}

/** Cortex exchange API origin for the public instrument catalogue (no auth). */
export function resolveCortexExchangeApiOrigin(): string {
  const base = resolveGridInferenceApiBase();
  if (base.includes("api.dev.thegrid.ai")) {
    return "https://cortex.dev.spectrallabs.xyz";
  }
  if (base.includes("api.staging.thegrid.ai")) {
    return "https://cortex.staging.spectrallabs.xyz";
  }
  return "https://cortex.thegrid.ai";
}
