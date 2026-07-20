/**
 * grid-defaults.json (repo root) is published by the Grid registry generator and is the source
 * of truth for instrument specs. The CLI ships a fallback mirror for offline/bundled runs;
 * these tests pin the mirror to the committed file so the two can never drift apart, and cover
 * the pure spec builder the runtime refresh uses.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { resolveGridInstrumentModelSpec, specsFromGridDefaults } from "../shared/grid-instruments.js";
import { OPENCLAW_GRID_MODEL_MAX_TOKENS } from "../shared/vendor-routing.js";

const GRID_DEFAULTS_PATH = join(import.meta.dir, "../../../..", "grid-defaults.json");
const gridDefaults = JSON.parse(readFileSync(GRID_DEFAULTS_PATH, "utf-8")) as {
  models: Array<{ id: string; maxTokens: number; contextWindow: number; input: string[] }>;
};

describe("grid-defaults.json parity", () => {
  it("has the registry-generator shape", () => {
    expect(gridDefaults.models.length).toBeGreaterThan(0);
    for (const model of gridDefaults.models) {
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxTokens).toBeGreaterThan(0);
      expect(model.maxTokens).toBeLessThanOrEqual(model.contextWindow);
      expect(model.input.length).toBeGreaterThan(0);
    }
  });

  it("fallback mirror matches the committed catalogue (update both together)", () => {
    for (const model of gridDefaults.models) {
      const spec = resolveGridInstrumentModelSpec(model.id);
      expect(spec.contextWindow).toBe(model.contextWindow);
      expect([...spec.input]).toEqual(model.input);
      expect(spec.maxOutputTokens).toBe(Math.min(OPENCLAW_GRID_MODEL_MAX_TOKENS, model.maxTokens));
    }
  });

  it("specsFromGridDefaults builds the same map the fallback mirrors", () => {
    const specs = specsFromGridDefaults(gridDefaults);
    expect(specs).not.toBeNull();
    for (const model of gridDefaults.models) {
      expect(specs?.[model.id]).toEqual({
        contextWindow: model.contextWindow,
        maxOutputTokens: Math.min(OPENCLAW_GRID_MODEL_MAX_TOKENS, model.maxTokens),
        input: model.input as ("text" | "image")[],
      });
    }
  });

  it("specsFromGridDefaults rejects malformed bodies", () => {
    expect(specsFromGridDefaults(null)).toBeNull();
    expect(specsFromGridDefaults({})).toBeNull();
    expect(specsFromGridDefaults({ models: [] })).toBeNull();
    expect(
      specsFromGridDefaults({ models: [{ id: "x", contextWindow: -1, maxTokens: 1, input: ["text"] }] }),
    ).toBeNull();
    expect(
      specsFromGridDefaults({ models: [{ id: "x", contextWindow: 10, maxTokens: 1, input: ["video"] }] }),
    ).toBeNull();
  });
});
