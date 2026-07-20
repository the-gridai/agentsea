// Per-agent Grid instrument defaults — sourced from grid-defaults.json (repo root), the
// catalogue file published by the Grid registry generator.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RAW_BASE } from "../manifest.js";
import { GRID_INFERENCE_DEFAULT_MODEL_ID, OPENCLAW_GRID_MODEL_MAX_TOKENS } from "./vendor-routing.js";

export type GridInstrumentInputModality = "text" | "image";

/** Model capability metadata from the Grid instrument catalogue. */
export type GridInstrumentModelSpec = {
  /** Total context window (input + output budget) in tokens. */
  contextWindow: number;
  /** Per-response output cap wired into agent harness configs. */
  maxOutputTokens: number;
  /** Input modalities the instrument supports (Grid text instruments are text-only). */
  input: readonly GridInstrumentInputModality[];
};

/** One `models[]` entry of grid-defaults.json (registry-generator schema). */
type GridDefaultsModel = {
  id: string;
  maxTokens: number;
  contextWindow: number;
  input: GridInstrumentInputModality[];
};

/**
 * Fallback mirror of `grid-defaults.json` (repo root) for when the live file cannot be
 * loaded (bundled CLI, offline, before refresh). The grid-defaults-parity test asserts this
 * stays in sync with the committed file — update BOTH when the catalogue changes.
 */
const FALLBACK_MODEL_SPECS: Record<string, GridInstrumentModelSpec> = {
  "agent-prime": { contextWindow: 196_608, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "agent-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "agent-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-prime": { contextWindow: 196_608, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "code-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-prime": { contextWindow: 196_608, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-standard": { contextWindow: 128_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
  "text-max": { contextWindow: 1_000_000, maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS, input: ["text"] },
};

const DEFAULT_MODEL_SPEC: GridInstrumentModelSpec = {
  contextWindow: 128_000,
  maxOutputTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS,
  input: ["text"],
};

let MODEL_SPECS: Record<string, GridInstrumentModelSpec> = FALLBACK_MODEL_SPECS;

function isGridDefaultsModel(value: unknown): value is GridDefaultsModel {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.contextWindow === "number" &&
    m.contextWindow > 0 &&
    typeof m.maxTokens === "number" &&
    Array.isArray(m.input) &&
    m.input.every((i) => i === "text" || i === "image")
  );
}

/**
 * Build the spec map from a parsed grid-defaults.json body. Context window and modalities come
 * from the catalogue; the per-response output cap stays the harness-level default (never above
 * the catalogue's instrument cap).
 */
export function specsFromGridDefaults(doc: unknown): Record<string, GridInstrumentModelSpec> | null {
  if (doc === null || typeof doc !== "object") {
    return null;
  }
  const models = (doc as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0 || !models.every(isGridDefaultsModel)) {
    return null;
  }
  const specs: Record<string, GridInstrumentModelSpec> = {};
  for (const model of models) {
    specs[model.id.toLowerCase()] = {
      contextWindow: model.contextWindow,
      maxOutputTokens: Math.min(OPENCLAW_GRID_MODEL_MAX_TOKENS, model.maxTokens),
      input: model.input,
    };
  }
  return specs;
}

/** Walk up from cwd (max 10 dirs) to find the repo-root grid-defaults.json (dev checkouts). */
function findLocalGridDefaults(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "grid-defaults.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

const GRID_DEFAULTS_FETCH_TIMEOUT = 3_000;

/**
 * Refresh instrument specs from grid-defaults.json: local repo file first (dev checkouts),
 * then GitHub raw (installed CLIs). Never throws; on any failure the fallback mirror stays in
 * effect. Callers overlap this with other startup awaits so it adds no latency on the happy path.
 */
export async function refreshGridInstrumentSpecs(): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
    return;
  }
  try {
    const localPath = findLocalGridDefaults();
    if (localPath) {
      const specs = specsFromGridDefaults(JSON.parse(readFileSync(localPath, "utf-8")));
      if (specs) {
        MODEL_SPECS = specs;
        return;
      }
    }
    const res = await fetch(`${RAW_BASE}/grid-defaults.json`, {
      signal: AbortSignal.timeout(GRID_DEFAULTS_FETCH_TIMEOUT),
    });
    if (!res.ok) {
      return;
    }
    const specs = specsFromGridDefaults(await res.json());
    if (specs) {
      MODEL_SPECS = specs;
    }
  } catch {
    // Offline or malformed feed — the committed fallback mirror keeps provisioning correct.
  }
}

export function _resetGridInstrumentSpecsForTesting(): void {
  MODEL_SPECS = FALLBACK_MODEL_SPECS;
}

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
    ? (normalizeUserCatalogModelId(userUtility) ?? envUtility ?? profile.utility)
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
