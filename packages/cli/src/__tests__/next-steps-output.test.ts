import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Manifest } from "../manifest.js";
import { formatAgentNextSteps } from "@agentsea/sdk";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const manifest: Manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "manifest.json"), "utf-8"));

describe("writeAgentNextSteps formatting", () => {
  it("formats Hermes next steps for CLI output", () => {
    const lines = formatAgentNextSteps(manifest, "hermes", { bullet: "  • " });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.some((line) => line.includes("dashboard"))).toBe(true);
    expect(lines.some((line) => line.includes("hermes-agent.nousresearch.com/docs"))).toBe(true);
    expect(lines.join("\n")).toMatchSnapshot();
  });
});
