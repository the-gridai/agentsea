import { describe, expect, it } from "bun:test";
import type { Manifest } from "../manifest-schema.js";
import { agentNextSteps, formatAgentNextSteps, formatNextStepLine } from "../next-steps.js";

const manifest: Manifest = {
  agents: {
    demo: {
      name: "Demo",
      description: "d",
      url: "https://demo.example",
      install: "true",
      launch: "demo",
      env: {},
      next_steps: [
        {
          text: "Say hello in the terminal.",
        },
        {
          text: "Read the official guide.",
          link: { label: "Docs", url: "https://docs.example/start" },
        },
      ],
    },
  },
  clouds: {},
  matrix: {},
};

describe("next-steps", () => {
  it("returns empty array when agent has no next_steps", () => {
    expect(agentNextSteps(manifest, "missing")).toEqual([]);
  });

  it("formats bullets with optional doc links", () => {
    expect(formatNextStepLine(manifest.agents.demo!.next_steps![0]!)).toBe("• Say hello in the terminal.");
    expect(formatNextStepLine(manifest.agents.demo!.next_steps![1]!)).toBe(
      "• Read the official guide. — Docs: https://docs.example/start",
    );
  });

  it("formats all steps for an agent", () => {
    expect(formatAgentNextSteps(manifest, "demo")).toEqual([
      "• Say hello in the terminal.",
      "• Read the official guide. — Docs: https://docs.example/start",
    ]);
  });
});
