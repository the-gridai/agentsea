import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { confirm } from "../shared/ui.js";

describe("confirm", () => {
  const prevNonInteractive = process.env.AGENTSEA_NON_INTERACTIVE;

  beforeEach(() => {
    process.env.AGENTSEA_NON_INTERACTIVE = "1";
  });

  afterEach(() => {
    if (prevNonInteractive !== undefined) {
      process.env.AGENTSEA_NON_INTERACTIVE = prevNonInteractive;
    } else {
      delete process.env.AGENTSEA_NON_INTERACTIVE;
    }
  });

  it("throws in non-interactive mode instead of hanging on stdin", async () => {
    await expect(confirm("Continue?")).rejects.toThrow("AGENTSEA_NON_INTERACTIVE");
  });
});
