import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildGridOAuthSession,
  clearGridOAuthSession,
  ensureFreshGridOAuthSession,
  loadGridOAuthSession,
  saveGridOAuthSession,
  type GridOAuthSession,
} from "../shared/grid-oauth-session.js";
import { getGridOAuthSessionPath } from "../shared/paths.js";

describe("grid-oauth-session", () => {
  const originalFetch = globalThis.fetch;
  const originalHome = process.env.AGENTSEA_HOME;
  const baseHome = process.env.HOME || "/tmp";
  let testHome = "";

  beforeEach(() => {
    testHome = join(baseHome, `.agentsea-oauth-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
    mkdirSync(testHome, { recursive: true, mode: 0o700 });
    process.env.AGENTSEA_HOME = testHome;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome !== undefined) {
      process.env.AGENTSEA_HOME = originalHome;
    } else {
      delete process.env.AGENTSEA_HOME;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists OAuth session with strict file permissions", () => {
    const session = buildGridOAuthSession(
      {
        access_token: "access_1",
        refresh_token: "refresh_1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "account:read keys:manage",
      },
      "https://trading.api.thegrid.ai",
      "agentsea-test",
    );

    expect(saveGridOAuthSession(session)).toBe(true);
    const loaded = loadGridOAuthSession();
    expect(loaded?.access_token).toBe("access_1");
    expect(loaded?.oauth_scopes).toContain("keys:manage");

    const mode = statSync(getGridOAuthSessionPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("refreshes expired sessions and persists new token state", async () => {
    const expiredSession: GridOAuthSession = {
      access_token: "old_access",
      refresh_token: "old_refresh",
      token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      oauth_base_url: "https://trading.api.thegrid.ai",
      oauth_scopes: ["account:read", "keys:manage"],
      client_id: "agentsea-test",
    };
    saveGridOAuthSession(expiredSession);

    let seenRefreshGrant = false;
    globalThis.fetch = (async (_url, init) => {
      const body = String(init?.body ?? "");
      seenRefreshGrant = body.includes("\"grant_type\":\"refresh_token\"");
      return new Response(
        JSON.stringify({
          access_token: "new_access",
          refresh_token: "new_refresh",
          token_type: "Bearer",
          expires_in: 600,
          scope: "account:read keys:manage",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const refreshed = await ensureFreshGridOAuthSession(expiredSession);
    expect(seenRefreshGrant).toBe(true);
    expect(refreshed.access_token).toBe("new_access");
    expect(refreshed.refresh_token).toBe("new_refresh");

    const loaded = loadGridOAuthSession();
    expect(loaded?.access_token).toBe("new_access");
    expect(loaded?.refresh_token).toBe("new_refresh");
  });

  it("keeps prior refresh token when refresh response omits it", async () => {
    const expiredSession: GridOAuthSession = {
      access_token: "old_access",
      refresh_token: "old_refresh",
      token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      oauth_base_url: "https://trading.api.thegrid.ai",
      oauth_scopes: ["account:read", "keys:manage"],
      client_id: "agentsea-test",
    };
    saveGridOAuthSession(expiredSession);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "new_access",
          token_type: "Bearer",
          expires_in: 600,
          scope: "account:read keys:manage",
        }),
        { status: 200 },
      )) as typeof fetch;

    const refreshed = await ensureFreshGridOAuthSession(expiredSession);
    expect(refreshed.access_token).toBe("new_access");
    expect(refreshed.refresh_token).toBe("old_refresh");
  });

  it("clears persisted session data", () => {
    const session = buildGridOAuthSession(
      {
        access_token: "access_1",
        refresh_token: "refresh_1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "keys:manage",
      },
      "https://trading.api.thegrid.ai",
      "agentsea-test",
    );
    saveGridOAuthSession(session);
    expect(loadGridOAuthSession()).not.toBeNull();

    clearGridOAuthSession();
    expect(loadGridOAuthSession()).toBeNull();
  });
});
