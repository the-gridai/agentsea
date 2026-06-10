import { afterEach, describe, expect, it } from "bun:test";
import { logError, resetStderrAttributes } from "../shared/ui.js";

describe("stderr color reset", () => {
  const origIsTTY = process.stderr.isTTY;
  const origWrite = process.stderr.write.bind(process.stderr);
  let writes: string[] = [];

  afterEach(() => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
    process.stderr.write = origWrite;
    writes = [];
  });

  it("resetStderrAttributes writes SGR reset on a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    resetStderrAttributes();
    expect(writes).toEqual(["\x1b[0m"]);
  });

  it("logError resets stderr after clack error output", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    logError("test failure");
    expect(writes.at(-1)).toBe("\x1b[0m");
  });
});
