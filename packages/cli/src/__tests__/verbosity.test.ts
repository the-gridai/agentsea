import { afterEach, describe, expect, it } from "bun:test";
import { isAgentseaVerbose } from "../shared/verbosity.js";

describe("verbosity", () => {
  const original = process.env.AGENTSEA_VERBOSE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENTSEA_VERBOSE;
    } else {
      process.env.AGENTSEA_VERBOSE = original;
    }
  });

  it("returns false when unset", () => {
    delete process.env.AGENTSEA_VERBOSE;
    expect(isAgentseaVerbose()).toBe(false);
  });

  it("returns true for AGENTSEA_VERBOSE=1", () => {
    process.env.AGENTSEA_VERBOSE = "1";
    expect(isAgentseaVerbose()).toBe(true);
  });

  it("returns true for AGENTSEA_VERBOSE=true (case-insensitive)", () => {
    process.env.AGENTSEA_VERBOSE = "TRUE";
    expect(isAgentseaVerbose()).toBe(true);
  });
});

describe("remoteExecStdio", () => {
  const original = process.env.AGENTSEA_VERBOSE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENTSEA_VERBOSE;
    } else {
      process.env.AGENTSEA_VERBOSE = original;
    }
  });

  it("pipes remote output when not verbose", async () => {
    delete process.env.AGENTSEA_VERBOSE;
    const { remoteExecStdio } = await import("../shared/ssh.js");
    expect(remoteExecStdio()).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("inherits remote output when verbose", async () => {
    process.env.AGENTSEA_VERBOSE = "1";
    const { remoteExecStdio } = await import("../shared/ssh.js");
    expect(remoteExecStdio()).toEqual(["ignore", "inherit", "inherit"]);
  });
});
