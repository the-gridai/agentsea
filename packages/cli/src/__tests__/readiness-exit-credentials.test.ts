import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const VALID_GRID_KEY = `sk-or-v1-${"f".repeat(64)}`;

describe("runDigitalOceanReadinessGate exit credentials", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevBunEnv = process.env.BUN_ENV;
  const prevApiKey = process.env.THEGRID_API_KEY;
  const prevSkipValidation = process.env.AGENTSEA_SKIP_API_VALIDATION;
  const prevNonInteractive = process.env.AGENTSEA_NON_INTERACTIVE;
  const prevHeadless = process.env.AGENTSEA_HEADLESS;

  beforeEach(() => {
    mock.restore();
    delete process.env.NODE_ENV;
    delete process.env.BUN_ENV;
    process.env.THEGRID_API_KEY = VALID_GRID_KEY;
    process.env.AGENTSEA_SKIP_API_VALIDATION = "1";
    delete process.env.AGENTSEA_NON_INTERACTIVE;
    delete process.env.AGENTSEA_HEADLESS;
  });

  afterEach(() => {
    mock.restore();
    if (prevNodeEnv !== undefined) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (prevBunEnv !== undefined) {
      process.env.BUN_ENV = prevBunEnv;
    } else {
      delete process.env.BUN_ENV;
    }
    if (prevApiKey !== undefined) {
      process.env.THEGRID_API_KEY = prevApiKey;
    } else {
      delete process.env.THEGRID_API_KEY;
    }
    if (prevSkipValidation !== undefined) {
      process.env.AGENTSEA_SKIP_API_VALIDATION = prevSkipValidation;
    } else {
      delete process.env.AGENTSEA_SKIP_API_VALIDATION;
    }
    if (prevNonInteractive !== undefined) {
      process.env.AGENTSEA_NON_INTERACTIVE = prevNonInteractive;
    } else {
      delete process.env.AGENTSEA_NON_INTERACTIVE;
    }
    if (prevHeadless !== undefined) {
      process.env.AGENTSEA_HEADLESS = prevHeadless;
    } else {
      delete process.env.AGENTSEA_HEADLESS;
    }
  });

  it("does not re-prompt for API key when env key is already valid", async () => {
    // Never mock ../shared/oauth.js — mock.module replaces verifyTheGridApiKey globally
    // and breaks oauth-validation-cache.test.ts when Bun runs files in parallel (CI).
    mock.module("../digitalocean/digitalocean.js", () => ({
      areSshKeysRegisteredOnDigitalOcean: async () => true,
      ensureDoToken: async () => {},
      ensureSshKey: async () => {},
      fetchDoAccountSnapshot: async () => ({
        status: "active",
        email_verified: true,
        droplet_limit: 10,
      }),
      getDropletCount: async () => 0,
      preloadDigitalOceanApiTokenForReadiness: () => true,
    }));
    mock.module("../commands/shared.js", () => ({
      isInteractiveTTY: () => false,
    }));
    mock.module("../digitalocean/readiness-checklist.js", () => ({
      renderReadinessChecklist: () => {},
    }));

    const { runDigitalOceanReadinessGate } = await import("../digitalocean/readiness.js");
    await runDigitalOceanReadinessGate({ agentName: "hermes" });
    expect(process.env.THEGRID_API_KEY).toBe(VALID_GRID_KEY);
  });
});
