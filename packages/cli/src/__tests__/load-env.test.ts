/**
 * Tests for load-env.ts resolution rules (AGENTSEA_ROOT vs cwd walk).
 * Uses exported loadAgentSeaDotenv — dotenv does not override existing env vars.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentSeaDotenv } from "../load-env.js";

describe("loadAgentSeaDotenv", () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = {
      AGENTSEA_ROOT: process.env.AGENTSEA_ROOT,
      LOAD_ENV_TEST_A: process.env.LOAD_ENV_TEST_A,
      LOAD_ENV_TEST_B: process.env.LOAD_ENV_TEST_B,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k as keyof NodeJS.ProcessEnv] = v;
      }
    }
  });

  it("loads .env from AGENTSEA_ROOT without overriding preset vars", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-env-root-"));
    try {
      writeFileSync(join(dir, ".env"), 'LOAD_ENV_TEST_A=from-file\nLOAD_ENV_TEST_B=also-from-file\n');
      process.env.AGENTSEA_ROOT = dir;
      process.env.LOAD_ENV_TEST_A = "preset";
      delete process.env.LOAD_ENV_TEST_B;
      loadAgentSeaDotenv();
      expect(process.env.LOAD_ENV_TEST_A).toBe("preset");
      expect(process.env.LOAD_ENV_TEST_B).toBe("also-from-file");
    } finally {
      rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  });

  it("walks up from cwd when AGENTSEA_ROOT is unset", () => {
    const repo = mkdtempSync(join(tmpdir(), "grid-env-repo-"));
    const nested = join(repo, "nested");
    mkdirSync(nested, {
      recursive: true,
    });
    writeFileSync(join(repo, "manifest.json"), "{}");
    writeFileSync(join(repo, ".env"), "LOAD_ENV_TEST_B=walked\n");

    delete process.env.AGENTSEA_ROOT;
    delete process.env.LOAD_ENV_TEST_B;

    const prev = process.cwd();
    try {
      process.chdir(nested);
      loadAgentSeaDotenv();
      expect(process.env.LOAD_ENV_TEST_B).toBe("walked");
    } finally {
      process.chdir(prev);
      rmSync(repo, {
        recursive: true,
        force: true,
      });
    }
  });
});
