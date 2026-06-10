// Per-agent Grid instrument defaults — aligned with thegrid.ai integration docs.

import { GRID_INFERENCE_DEFAULT_MODEL_ID, OPENCLAW_GRID_MODEL_MAX_TOKENS } from "./vendor-routing.js";

export type GridInstrumentInputModality = "text" | "image";

/** Model capability metadata from the Cortex instrument catalogue (ai_specs). */
export type GridInstrumentModelSpec = {
  /** Total context window (input + output budget) in tokens. */
  contextWindow: number;
  /** Per-response output cap wired into agent harness configs. */
  maxOutputTokens: number;
  /** Input modalities the instrument supports (Grid text instruments are text-only). */
  input: readonly GridInstrumentInputModality[];
};

/**
 * Static Cortex `ai_specs` mirror for provision-time agent configs.
 * Source: `GET https://cortex.thegrid.ai/api/v1/instruments/by-symbol/:symbol`
 * (context_window, max_output_length). Re-sync when catalogue changes.
 */
const MODEL_SPECS: Record<string, GridInstrumentModelSpec> = {
  "agent-prime": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "agent-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "agent-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-prime": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-prime": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
};

const DEFAULT_MODEL_SPEC: GridInstrumentModelSpec = {
  contextWindow: 128_000,
  maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS,
  input: ["text"],
};

/** Resolve catalogue model capabilities for agent provisioning (context, output cap, modalities). */
export function resolveGridInstrumentModelSpec(instrumentId: string): GridInstrumentModelSpec {
  const id = typeof instrumentId === "string" ? instrumentId.trim().toLowerCase() : "";
  if (!id) {
    return DEFAULT_MODEL_SPEC;
  }
  return MODEL_SPECS[id] ?? DEFAULT_MODEL_SPEC;
}

export function gridInstrumentSupportsVision(instrumentId: string): boolean {
  return resolveGridInstrumentModelSpec(instrumentId).input.includes("image");
}

export type GridInstrumentProfile = {
  /** Primary instrument for agent loops / chat. */
  primary: string;
  /** Cheaper tier for utility calls (OpenCode small_model, OpenClaw heartbeats). */
  utility?: string;
  /** Additional instruments registered in provider allowlists. */
  extras?: readonly string[];
};

/** Claude Code maps Anthropic families → Grid text instruments (claude-code integration doc). */
export const CLAUDE_GRID_FAMILY_ENV = {
  sonnet: "text-prime",
  haiku: "text-standard",
  opus: "text-max",
  subagent: "text-standard",
} as const;

const PROFILES: Record<string, GridInstrumentProfile> = {
  claude: {
    primary: CLAUDE_GRID_FAMILY_ENV.sonnet,
    utility: CLAUDE_GRID_FAMILY_ENV.haiku,
    extras: [CLAUDE_GRID_FAMILY_ENV.opus, CLAUDE_GRID_FAMILY_ENV.subagent],
  },
  openclaw: {
    primary: "agent-prime",
    utility: "agent-standard",
    extras: ["code-prime", "code-max", "agent-max"],
  },
  opencode: {
    primary: "code-prime",
    utility: "code-standard",
    extras: ["agent-prime", "agent-standard"],
  },
  kilocode: {
    primary: "agent-prime",
    utility: "code-prime",
    extras: ["agent-standard", "code-standard", "agent-max"],
  },
  hermes: {
    primary: "agent-prime",
    utility: "agent-standard",
    extras: ["agent-max", "code-prime"],
  },
  junie: { primary: "code-prime", extras: ["agent-prime", "agent-standard"] },
  pi: { primary: "code-prime", extras: ["agent-prime"] },
  codex: {
    primary: "code-prime",
    utility: GRID_INFERENCE_DEFAULT_MODEL_ID,
    extras: ["code-standard", "agent-prime"],
  },
  t3code: { primary: "code-prime", utility: GRID_INFERENCE_DEFAULT_MODEL_ID },
  cursor: { primary: "code-prime", extras: ["agent-prime", GRID_INFERENCE_DEFAULT_MODEL_ID] },
};

export function resolveGridInstrumentProfile(agentSlug: string): GridInstrumentProfile {
  return PROFILES[agentSlug] ?? { primary: GRID_INFERENCE_DEFAULT_MODEL_ID };
}

/** Pick catalogue model: explicit user choice wins, else agent primary default. */
export function resolveAgentGridModelId(agentSlug: string, modelId?: string): string {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (trimmed.length > 0 && !/^openrouter\//i.test(trimmed)) {
    return trimmed;
  }
  return resolveGridInstrumentProfile(agentSlug).primary;
}

export type HarnessGridInstruments = {
  /** Primary model for agent loops / chat (user may override via picker). */
  primary: string;
  /** Cheaper tier for heartbeats, compression, and other utility calls. */
  utility?: string;
  /** All catalogue ids registered in the harness provider allowlist. */
  registered: string[];
};

function uniqueInstrumentIds(ids: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = typeof id === "string" ? id.trim() : "";
    if (!t || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeUserCatalogModelId(modelId: string | undefined): string | undefined {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed || /^openrouter\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Agents that support a separate heartbeat / utility model picker. */
export function agentSupportsHeartbeatModel(agentSlug: string): boolean {
  return resolveGridInstrumentProfile(agentSlug).utility !== undefined;
}

/**
 * Resolve harness instruments from user picks (thinking + heartbeat) with profile fallbacks.
 * Heartbeat id may also come from `AGENTSEA_HEARTBEAT_MODEL_ID` when not passed explicitly.
 */
export function resolveHarnessGridInstruments(
  agentSlug: string,
  userPrimary?: string,
  userUtility?: string,
): HarnessGridInstruments {
  const profile = resolveGridInstrumentProfile(agentSlug);
  const primary = normalizeUserCatalogModelId(userPrimary) ?? profile.primary;
  const envUtility = normalizeUserCatalogModelId(process.env.AGENTSEA_HEARTBEAT_MODEL_ID);
  const utility = profile.utility
    ? normalizeUserCatalogModelId(userUtility) ?? envUtility ?? profile.utility
    : undefined;
  const registered = uniqueInstrumentIds([primary, utility, ...(profile.extras ?? [])]);
  return {
    primary,
    utility,
    registered,
  };
}

/** Default catalogue id for provision prompts when MODEL_ID is unset. */
export function defaultGridModelForAgent(agentSlug: string): string {
  return resolveGridInstrumentProfile(agentSlug).primary;
}

