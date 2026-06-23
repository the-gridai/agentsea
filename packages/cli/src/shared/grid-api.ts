/** Env var for overriding The Grid OpenAI-compatible inference API base (e.g. dev/staging). */
export const THEGRID_API_URL_ENV = "THEGRID_API_URL";
/** Optional override for Grid OAuth/Exchange API origin (no `/api/v1` suffix). */
export const AGENTSEA_GRID_OAUTH_BASE_URL_ENV = "AGENTSEA_GRID_OAUTH_BASE_URL";

/** Production inference API base (`GET ?/models`, `POST ?/chat/completions`). */
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

/** Optional `THEGRID_API_URL=?` line for ~/.agentsearc when a local override is active. */
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

/** Hermes named custom provider slug in config.yaml (`provider: custom:thegrid`). */
export const HERMES_GRID_CUSTOM_PROVIDER_NAME = "thegrid";

/** Hermes `custom_providers[].name` reference for headless CLI (`--provider custom:thegrid`). */
export const HERMES_GRID_CUSTOM_PROVIDER = `custom:${HERMES_GRID_CUSTOM_PROVIDER_NAME}`;

/**
 * Hermes `custom_providers[].base_url` for `api_mode: anthropic_messages`.
 * Must NOT include `/v1` ? the Anthropic SDK appends `/v1/messages` itself.
 * (OpenClaw uses {@link resolveGridOpenClawMessagesBase} which includes `/v1`.)
 */
export function resolveGridHermesMessagesBase(): string {
  return resolveGridAnthropicMessagesClientBase();
}

export type OpenClawGridProviderWire = "openai-completions" | "anthropic-messages";

/** OpenClaw provider wiring. Set AGENTSEA_OPENCLAW_SSRF_SAFE=1 for messages-beta (no cross-host redirects). */
export function resolveOpenClawGridProvider(): { baseUrl: string; api: OpenClawGridProviderWire } {
  if (process.env.AGENTSEA_OPENCLAW_SSRF_SAFE === "1") {
    return { baseUrl: resolveGridOpenClawMessagesBase(), api: "anthropic-messages" };
  }
  return { baseUrl: resolveGridInferenceApiBase(), api: "openai-completions" };
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
    return "https://cortex.dev.thegrid.ai";
  }
  if (base.includes("api.staging.thegrid.ai")) {
    return "https://cortex.staging.thegrid.ai";
  }
  return "https://cortex.thegrid.ai";
}

/** Grid Exchange/OAuth API origin (`/api/v1/oauth/*`, `/api/v1/api-keys`). */
export const DEFAULT_GRID_EXCHANGE_API_ORIGIN = "https://cortex.thegrid.ai";

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Resolve Exchange OAuth host for device flow and key management.
 * Override with `AGENTSEA_GRID_OAUTH_BASE_URL` when needed (dev/staging/local).
 */
export function resolveGridExchangeApiOrigin(): string {
  const override = process.env[AGENTSEA_GRID_OAUTH_BASE_URL_ENV]?.trim();
  if (override) {
    return normalizeOrigin(override);
  }
  const base = resolveGridInferenceApiBase();
  if (base.includes("api.dev.thegrid.ai")) {
    return "https://cortex.dev.thegrid.ai";
  }
  if (base.includes("api.staging.thegrid.ai")) {
    return "https://cortex.staging.thegrid.ai";
  }
  return DEFAULT_GRID_EXCHANGE_API_ORIGIN;
}
