import { describe, expect, it } from "bun:test";
import { cloudInitAptBootstrapLines, getPackagesForTier } from "../shared/cloud-init.js";

describe("cloudInitAptBootstrapLines", () => {
  it("retries apt update and install for DO mirror desync", () => {
    const script = cloudInitAptBootstrapLines(getPackagesForTier("minimal")).join("\n");
    expect(script.includes("Acquire::Retries=3")).toBe(true);
    expect(script.includes("attempt $_try/5")).toBe(true);
    expect(script.includes("attempt $_try/3")).toBe(true);
    expect(script.includes("curl")).toBe(true);
  });
});
