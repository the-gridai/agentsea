import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  clearSavedTheGridApiKey,
  getOrPromptApiKey,
  loginWithGridOAuthAndKey,
  resetGridApiKeyValidationCacheForTests,
  setGridApiKeyValidationFetchForTests,
} from "../shared/oauth.js";
import { getAgentseaCloudConfigPath } from "../shared/paths.js";
import { clearGridOAuthSession } from "../shared/grid-oauth-session.js";

const ENV_KEY = `sk-or-v1-${"a".repeat(64)}`;
const SAVED_KEY = `sk-or-v1-${"b".repeat(64)}`;
const OAUTH_KEY = `sk-or-v1-${"c".repeat(64)}`;

function saveGridKey(key: string): void {
  const path = getAgentseaCloudConfigPath("thegrid");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ api_key: key }, null, 2) + "\n", { mode: 0o600 });
}

describe("getOrPromptApiKey fallback order", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;
  const originalStderrTTY = process.stderr.isTTY;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    delete process.env.THEGRID_API_KEY;
    delete process.env.AGENTSEA_REAUTH;
    delete process.env.AGENTSEA_NON_INTERACTIVE;
    delete process.env.AGENTSEA_GRID_OAUTH;
    process.env.AGENTSEA_SKIP_API_VALIDATION = "0";
    clearSavedTheGridApiKey();
    clearGridOAuthSession();
    resetGridApiKeyValidationCacheForTests();
    setGridApiKeyValidationFetchForTests(undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    clearSavedTheGridApiKey();
    clearGridOAuthSession();
    resetGridApiKeyValidationCacheForTests();
    setGridApiKeyValidationFetchForTests(undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTTY, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: originalStderrTTY, configurable: true });
  });

  it("uses env key before saved key or OAuth", async () => {
    process.env.THEGRID_API_KEY = ENV_KEY;
    process.env.AGENTSEA_GRID_OAUTH = "1";
    saveGridKey(SAVED_KEY);

    let validationCalls = 0;
    setGridApiKeyValidationFetchForTests(async () => {
      validationCalls++;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    globalThis.fetch = (async () => {
      throw new Error("OAuth endpoints should not be called when env key is valid");
    }) as typeof fetch;

    const key = await getOrPromptApiKey("claude", "sprite");
    expect(key).toBe(ENV_KEY);
    expect(validationCalls).toBe(1);
  });

  it("uses saved key before attempting OAuth", async () => {
    process.env.AGENTSEA_GRID_OAUTH = "1";
    saveGridKey(SAVED_KEY);

    setGridApiKeyValidationFetchForTests(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = (async () => {
      throw new Error("OAuth endpoints should not be called when saved key is valid");
    }) as typeof fetch;

    const key = await getOrPromptApiKey("claude", "sprite");
    expect(key).toBe(SAVED_KEY);
  });

  it("uses OAuth key when env/saved key are unavailable", async () => {
    process.env.AGENTSEA_OPEN_GRID_APP = "0";
    const seen: string[] = [];

    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      seen.push(`${init?.method ?? "GET"} ${u}`);
      if (u.endsWith("/api/v1/oauth/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-code",
            user_code: "A1B2-C3D4",
            verification_uri: "https://app.thegrid.ai/device",
            expires_in: 120,
            interval: 0,
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/v1/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access_token_123",
            refresh_token: "refresh_token_123",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "account:read keys:manage",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/v1/api-keys") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (u.endsWith("/api/v1/api-keys") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "key_123",
              name: "agentsea-key",
              key_prefix: "sk-or-v1-cccc",
              key: OAUTH_KEY,
              is_active: true,
            },
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const key = await getOrPromptApiKey("claude", "sprite");
    expect(key).toBe(OAUTH_KEY);
    expect(seen.some((line) => line.includes("/api/v1/oauth/device/code"))).toBe(true);
    expect(seen.some((line) => line.includes("/api/v1/api-keys"))).toBe(true);
  });

  it("shows headless guidance when no key can be prompted", async () => {
    process.env.AGENTSEA_GRID_OAUTH = "1";
    process.env.AGENTSEA_NON_INTERACTIVE = "1";
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

    await expect(getOrPromptApiKey("claude", "sprite")).rejects.toThrow(/headless mode/i);
  });

  it("supports opting out of default OAuth auto-attempt", async () => {
    process.env.AGENTSEA_GRID_OAUTH = "0";
    process.env.AGENTSEA_NON_INTERACTIVE = "1";
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    await expect(getOrPromptApiKey("claude", "sprite")).rejects.toThrow(/headless mode/i);
    expect(fetchCalled).toBe(false);
  });

  it("allows auth login when stdin is non-tty but output tty is available", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    process.env.AGENTSEA_OPEN_GRID_APP = "0";

    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.endsWith("/api/v1/oauth/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-code",
            user_code: "A1B2-C3D4",
            verification_uri: "https://app.thegrid.ai/device",
            expires_in: 120,
            interval: 0,
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/v1/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access_token_123",
            refresh_token: "refresh_token_123",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "account:read keys:manage",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/v1/api-keys") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (u.endsWith("/api/v1/api-keys") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "key_123",
              name: "agentsea-key",
              key_prefix: "sk-or-v1-cccc",
              key: OAUTH_KEY,
              is_active: true,
            },
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await expect(loginWithGridOAuthAndKey()).resolves.toBe(OAUTH_KEY);
  });
});
