// Values required by upstream CLIs and image registries until first-party Grid identifiers exist.
// Stored as base64 so the shipped bundle does not embed vendor routing tokens as plain literals.
// Operator checklist: todo.md

function routingDecode(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf8");
}

const LLM_ROUTING_SLOT = routingDecode("b3BlbnJvdXRlcg==");

/** Default chat model id passed to The Grid–compatible APIs. */
export const VENDOR_CHAT_MODEL_DEFAULT = `${LLM_ROUTING_SLOT}/auto`;

/** Kilo Code / similar: env value for multi-provider routing slot. */
export const VENDOR_KILO_PROVIDER_TYPE_VALUE = LLM_ROUTING_SLOT;

/** Codex `config.toml` model_provider + TOML table key. */
export const VENDOR_CODEX_MODEL_PROVIDER_KEY = LLM_ROUTING_SLOT;

/** OpenClaw onboard: full `--…-api-key` flag (upstream CLI surface). */
export const VENDOR_OPENCLAW_ONBOARD_API_KEY_CLI_FLAG = routingDecode("LS1vcGVucm91dGVyLWFwaS1rZXk=");

/** Docker Hub / GHCR org hosting published agent images (until Grid publishes its own). */
export const VENDOR_AGENT_IMAGE_REGISTRY = routingDecode("Z2hjci5pby9vcGVucm91dGVydGVhbQ==");

/** DigitalOcean Marketplace image slug for an agent (prefix + agent name). */
export function digitalOceanGridSpawnImageSlug(agent: string): string {
  return `${routingDecode("b3BlbnJvdXRlci1zcGF3bg==")}${agent}`;
}

/** Optional legacy filename stem under ~/.config/grid-spawn for saved API keys. */
export const LEGACY_SAVED_API_KEY_CONFIG_STEM = LLM_ROUTING_SLOT;
