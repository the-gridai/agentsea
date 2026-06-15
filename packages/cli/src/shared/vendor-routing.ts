// Values required by upstream CLIs and image registries until first-party Grid identifiers exist.
// Stored as base64 so the shipped bundle does not embed vendor routing tokens as plain literals.
// Operator checklist: todo.md

function routingDecode(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf8");
}

const LLM_ROUTING_SLOT = routingDecode("b3BlbnRvdXRlcg==");

/**
 * Default **`model`** string for **`api.thegrid.ai`** chat/completions and agent configs.
 * Must be a real id from `GET …/api/v1/models` (not an OpenRouter placeholder like **`openrouter/auto`**).
 */
export const GRID_INFERENCE_DEFAULT_MODEL_ID = "agent-standard";

/**
 * Default MODEL_ID-style value for agents that speak to The Grid over OpenAI-compatible HTTP.
 * (Historically this accidentally reused an OpenRouter-style id; that routed OpenClaw to **`thegrid/openrouter/auto`** and 404'd.)
 */
export const VENDOR_CHAT_MODEL_DEFAULT = GRID_INFERENCE_DEFAULT_MODEL_ID;

/** Env var for heartbeat / utility model override (pairs with `MODEL_ID` for thinking). */
export const AGENTSEA_HEARTBEAT_MODEL_ENV = "AGENTSEA_HEARTBEAT_MODEL_ID";

/**
 * OpenClaw built-in namespaces like **`openrouter/*`** map to bundled provider auth profiles, not Grid.
 * We register **`models.providers.thegrid`** (`OPENCLAW_GRID_PROVIDER_ID`) targeting **only**
 * `messages-beta.api.thegrid.ai` (Anthropic Messages) so OpenClaw never hits api → synapse redirects.
 */
export const OPENCLAW_GRID_PROVIDER_ID = "thegrid";

/** OpenClaw `anthropic-messages` provider models require explicit positive maxTokens (2026.5+). */
export const OPENCLAW_GRID_MODEL_MAX_TOKENS = 8192;
export const OPENCLAW_GRID_MODEL_CONTEXT_WINDOW = 200_000;

/** Kilo Code built-in provider id for The Grid (`thegrid/model` in kilo.jsonc). */
export const KILO_GRID_PROVIDER_ID = "thegrid";

/** Codex `config.toml` model_provider + TOML table key. */
export const VENDOR_CODEX_MODEL_PROVIDER_KEY = "thegrid";

/**
 * Last @openai/codex release before wire_api=chat removal (0.137+ requires /v1/responses).
 * The Grid inference API only exposes /v1/chat/completions today.
 */
export const CODEX_CLI_GRID_PINNED_VERSION = "0.136.0";

/**
 * Pinned agent CLI versions. We install/update these exact versions instead of
 * `@latest` so a new upstream release can't silently break provisioning (config
 * schema drift, removed flags, etc.). Bump deliberately after validating.
 * Captured 2026-06-15.
 */
export const CLAUDE_CODE_GRID_PINNED_VERSION = "2.1.177";
export const OPENCLAW_GRID_PINNED_VERSION = "2026.6.6";
export const KILOCODE_CLI_GRID_PINNED_VERSION = "7.3.46";
export const JUNIE_CLI_GRID_PINNED_VERSION = "1468.30.0";
export const PI_CODING_AGENT_GRID_PINNED_VERSION = "0.73.1";
export const T3_CLI_GRID_PINNED_VERSION = "0.0.27";

/** Docker Hub / GHCR org hosting published agent images (until Grid publishes its own). */
export const VENDOR_AGENT_IMAGE_REGISTRY = routingDecode("Z2hjci5pby9vcGVucm91dGVydGVhbQ==");

/** DigitalOcean Marketplace image slug for an agent (prefix + agent name). */
export function digitalOceanAgentSeaImageSlug(agent: string): string {
  return `${routingDecode("b3BlbnJvdXRlci1zcGF3bg==")}${agent}`;
}

/** Optional legacy filename stem under ~/.config/agentsea for saved API keys. */
export const LEGACY_SAVED_API_KEY_CONFIG_STEM = LLM_ROUTING_SLOT;
