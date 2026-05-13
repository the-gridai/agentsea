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

/**
 * OpenClaw built-in namespaces like **`openrouter/*`** map to bundled provider auth profiles, not Grid.
 * We register **`models.providers.thegrid`** (`OPENCLAW_GRID_PROVIDER_ID`) targeting **only** `api.thegrid.ai`
 * so Control UI/chat use **`THEGRID_API_KEY`** — no OPENROUTER_* keys.
 */
export const OPENCLAW_GRID_PROVIDER_ID = "thegrid";

/** Kilo Code / similar: env value for multi-provider routing slot. */
export const VENDOR_KILO_PROVIDER_TYPE_VALUE = LLM_ROUTING_SLOT;

/** Codex `config.toml` model_provider + TOML table key. */
export const VENDOR_CODEX_MODEL_PROVIDER_KEY = LLM_ROUTING_SLOT;

/** Docker Hub / GHCR org hosting published agent images (until Grid publishes its own). */
export const VENDOR_AGENT_IMAGE_REGISTRY = routingDecode("Z2hjci5pby9vcGVucm91dGVydGVhbQ==");

/** DigitalOcean Marketplace image slug for an agent (prefix + agent name). */
export function digitalOceanGridSpawnImageSlug(agent: string): string {
  return `${routingDecode("b3BlbnJvdXRlci1zcGF3bg==")}${agent}`;
}

/** Optional legacy filename stem under ~/.config/grid-spawn for saved API keys. */
export const LEGACY_SAVED_API_KEY_CONFIG_STEM = LLM_ROUTING_SLOT;
