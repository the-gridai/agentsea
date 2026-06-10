import { describe, expect, it } from "bun:test";
import {
  gridInstrumentSupportsVision,
  resolveGridInstrumentModelSpec,
} from "../shared/grid-instruments.js";
import { OPENCLAW_GRID_MODEL_MAX_TOKENS } from "../shared/vendor-routing.js";

describe("grid instrument model specs", () => {
  it("uses Cortex catalogue context windows (not oversized defaults)", () => {
    expect(resolveGridInstrumentModelSpec("agent-prime").contextWindow).toBe(128_000);
    expect(resolveGridInstrumentModelSpec("code-prime").contextWindow).toBe(128_000);
    expect(resolveGridInstrumentModelSpec("text-prime").contextWindow).toBe(128_000);
    expect(resolveGridInstrumentModelSpec("agent-max").contextWindow).toBe(1_000_000);
    expect(resolveGridInstrumentModelSpec("code-max").contextWindow).toBe(1_000_000);
    expect(resolveGridInstrumentModelSpec("text-max").contextWindow).toBe(1_000_000);
  });

  it("marks Grid instruments text-only for harness modality wiring", () => {
    for (const id of ["agent-prime", "code-prime", "text-standard", "agent-max"]) {
      const spec = resolveGridInstrumentModelSpec(id);
      expect(spec.input).toEqual(["text"]);
      expect(gridInstrumentSupportsVision(id)).toBe(false);
    }
  });

  it("sets explicit positive output caps for OpenClaw-class agents", () => {
    expect(resolveGridInstrumentModelSpec("agent-prime").maxOutputTokens).toBe(OPENCLAW_GRID_MODEL_MAX_TOKENS);
    expect(resolveGridInstrumentModelSpec("unknown-slug").contextWindow).toBe(128_000);
  });
});
