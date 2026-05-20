import { afterEach, describe, expect, it } from "bun:test";
import { isSpawnVerbose } from "../shared/verbosity.js";

describe("verbosity", () => {
  const original = process.env.SPAWN_VERBOSE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SPAWN_VERBOSE;
    } else {
      process.env.SPAWN_VERBOSE = original;
    }
  });

  it("returns false when unset", () => {
    delete process.env.SPAWN_VERBOSE;
    expect(isSpawnVerbose()).toBe(false);
  });

  it("returns true for SPAWN_VERBOSE=1", () => {
    process.env.SPAWN_VERBOSE = "1";
    expect(isSpawnVerbose()).toBe(true);
  });

  it("returns true for SPAWN_VERBOSE=true (case-insensitive)", () => {
    process.env.SPAWN_VERBOSE = "TRUE";
    expect(isSpawnVerbose()).toBe(true);
  });
});

describe("remoteExecStdio", () => {
  const original = process.env.SPAWN_VERBOSE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SPAWN_VERBOSE;
    } else {
      process.env.SPAWN_VERBOSE = original;
    }
  });

  it("pipes remote output when not verbose", async () => {
    delete process.env.SPAWN_VERBOSE;
    const { remoteExecStdio } = await import("../shared/ssh.js");
    expect(remoteExecStdio()).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("inherits remote output when verbose", async () => {
    process.env.SPAWN_VERBOSE = "1";
    const { remoteExecStdio } = await import("../shared/ssh.js");
    expect(remoteExecStdio()).toEqual(["ignore", "inherit", "inherit"]);
  });
});
