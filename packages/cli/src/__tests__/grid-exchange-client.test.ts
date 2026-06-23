import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  attachGridConsumptionKeyCache,
  createGridConsumptionApiKey,
  findMatchingCachedGridConsumptionKey,
  listGridConsumptionApiKeys,
} from "../shared/grid-exchange-client.js";
import type { GridOAuthSession } from "../shared/grid-oauth-session.js";

function activeSession(): GridOAuthSession {
  return {
    access_token: "access_ok",
    refresh_token: "refresh_ok",
    token_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    oauth_base_url: "https://trading.api.thegrid.ai",
    oauth_scopes: ["account:read", "keys:manage"],
    client_id: "agentsea-test",
  };
}

describe("grid-exchange-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists and creates consumption API keys", async () => {
    let call = 0;
    globalThis.fetch = (async (url, init) => {
      call++;
      if (String(url).endsWith("/api-keys") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "key_1",
                name: "agentsea-old",
                key_prefix: "sk-or-v1-aaaa",
                is_active: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            id: "key_2",
            name: "agentsea-new",
            key_prefix: "sk-or-v1-bbbb",
            key: "sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            is_active: true,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const listed = await listGridConsumptionApiKeys(activeSession());
    expect(listed.keys.length).toBe(1);
    expect(listed.keys[0].id).toBe("key_1");

    const created = await createGridConsumptionApiKey(activeSession(), "agentsea-new");
    expect(created.key.id).toBe("key_2");
    expect(created.key.key).toContain("sk-or-v1-");
    expect(call).toBe(2);
  });

  it("reports exchange scope errors clearly", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "insufficient_scope" }), { status: 403 })) as typeof fetch;

    await expect(createGridConsumptionApiKey(activeSession(), "agentsea-new")).rejects.toThrow(/insufficient_scope/i);
  });

  it("matches reusable cached key by active key prefix", () => {
    const sessionWithCache: GridOAuthSession = {
      ...activeSession(),
      key_cache: {
        id: "key_1",
        key_prefix: "sk-or-v1-aaaa",
      },
    };
    const reusable = findMatchingCachedGridConsumptionKey(sessionWithCache, [
      {
        id: "key_1",
        name: "agentsea",
        key_prefix: "sk-or-v1-aaaa",
        is_active: true,
      },
    ], "sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(reusable).toBe("sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("attaches key cache metadata after key creation", () => {
    const cached = attachGridConsumptionKeyCache(activeSession(), {
      id: "key_2",
      name: "agentsea-new",
      key_prefix: "sk-or-v1-bbbb",
      is_active: true,
      key: "sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(cached.key_cache?.id).toBe("key_2");
    expect(cached.key_cache?.key_prefix).toBe("sk-or-v1-bbbb");
    expect((cached.key_cache as Record<string, unknown>).key).toBeUndefined();
  });

  it("retries once after 401 by forcing token refresh", async () => {
    let call = 0;
    globalThis.fetch = (async (url, init) => {
      call++;
      const u = String(url);
      if (u.endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "fresh_access",
            refresh_token: "fresh_refresh",
            token_type: "Bearer",
            expires_in: 1200,
            scope: "account:read keys:manage",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api-keys")) {
        const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
        if (auth.includes("access_ok")) {
          return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "key_1",
                name: "agentsea-old",
                key_prefix: "sk-or-v1-aaaa",
                is_active: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const listed = await listGridConsumptionApiKeys(activeSession());
    expect(listed.keys.length).toBe(1);
    expect(call).toBe(3);
  });
});
