import { describe, expect, it } from "bun:test";
import { formatProvisionElapsed, runWithSpinner } from "../shared/ui.js";

describe("provision spinner", () => {
  it("formats elapsed seconds and minutes", () => {
    expect(formatProvisionElapsed(0)).toBe("0s");
    expect(formatProvisionElapsed(45)).toBe("45s");
    expect(formatProvisionElapsed(60)).toBe("1m");
    expect(formatProvisionElapsed(135)).toBe("2m 15s");
  });

  it("runs work without spinner when stderr is not a TTY", async () => {
    const prev = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    try {
      const detail: string[] = [];
      const value = await runWithSpinner("Working…", async (handle) => {
        handle.setDetail("step one");
        detail.push("done");
        return 42;
      });
      expect(value).toBe(42);
      expect(detail).toEqual(["done"]);
    } finally {
      Object.defineProperty(process.stderr, "isTTY", { value: prev, configurable: true });
    }
  });
});
