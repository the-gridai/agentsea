import { describe, expect, it } from "bun:test";
import { formatProvisionElapsed, runWithSpinner } from "../shared/ui.js";

describe("provision spinner", () => {
  it("formats elapsed seconds and minutes", () => {
    expect(formatProvisionElapsed(0)).toBe("0s");
    expect(formatProvisionElapsed(45)).toBe("45s");
    expect(formatProvisionElapsed(60)).toBe("1m");
    expect(formatProvisionElapsed(135)).toBe("2m 15s");
  });

  it("updates a TTY spinner in place instead of printing new lines", async () => {
    const prevIsTTY = process.stderr.isTTY;
    const prevInline = process.env.AGENTSEA_INLINE_SPINNER;
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    process.env.AGENTSEA_INLINE_SPINNER = "1";
    process.stderr.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await runWithSpinner("Working…", async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return 1;
      });
      const combined = writes.join("");
      const spinnerFrames = (combined.match(/\r/g) ?? []).length;
      expect(spinnerFrames).toBeGreaterThan(1);
      expect((combined.match(/\n/g) ?? []).length).toBeLessThanOrEqual(2);
    } finally {
      process.stderr.write = origWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: prevIsTTY, configurable: true });
      if (prevInline === undefined) {
        delete process.env.AGENTSEA_INLINE_SPINNER;
      } else {
        process.env.AGENTSEA_INLINE_SPINNER = prevInline;
      }
    }
  });

  it("uses throttled step lines on WSL instead of rapid redraw spam", async () => {
    const prevIsTTY = process.stderr.isTTY;
    const prevInline = process.env.AGENTSEA_INLINE_SPINNER;
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    process.env.AGENTSEA_INLINE_SPINNER = "0";
    process.stderr.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await runWithSpinner("Working…", async (handle) => {
        handle.setDetail("phase one");
        await new Promise((resolve) => setTimeout(resolve, 50));
        handle.setDetail("phase two");
        return 1;
      });
      const combined = writes.join("");
      expect((combined.match(/\r/g) ?? []).length).toBe(0);
      expect((combined.match(/◐|◓|◑|◒/g) ?? []).length).toBe(0);
    } finally {
      process.stderr.write = origWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: prevIsTTY, configurable: true });
      if (prevInline === undefined) {
        delete process.env.AGENTSEA_INLINE_SPINNER;
      } else {
        process.env.AGENTSEA_INLINE_SPINNER = prevInline;
      }
    }
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
