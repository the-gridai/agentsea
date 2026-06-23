import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  pollGridOAuthToken,
  refreshGridOAuthToken,
  requestGridDeviceCode,
  revokeGridOAuthToken,
} from "../shared/grid-oauth-client.js";

describe("grid-oauth-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests device code with client and scopes", async () => {
    let seenBody = "";
    globalThis.fetch = (async (_url, init) => {
      seenBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          device_code: "dc_123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://app.thegrid.ai/device",
          expires_in: 300,
          interval: 0,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await requestGridDeviceCode("https://trading.api.thegrid.ai", "agentsea-test", [
      "account:read",
      "keys:manage",
    ]);
    expect(result.device_code).toBe("dc_123");
    expect(seenBody).toContain("agentsea-test");
    expect(seenBody).toContain("keys:manage");
  });

  it("accepts provider verification_uri_complete when returned", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          device_code: "dc_123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://app.thegrid.ai/device",
          verification_uri_complete: "https://app.thegrid.ai/device?user_code=ABCD-EFGH",
          expires_in: 300,
          interval: 0,
        }),
        { status: 200 },
      )) as typeof fetch;

    const result = await requestGridDeviceCode("https://trading.api.thegrid.ai", "agentsea-test");
    expect(result.verification_uri_complete).toContain("user_code=ABCD-EFGH");
  });

  it("polls until authorization succeeds", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          access_token: "access_ok",
          refresh_token: "refresh_ok",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "account:read keys:manage",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await pollGridOAuthToken(
      "https://trading.api.thegrid.ai",
      "agentsea-test",
      "device-code",
      0,
      30,
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.tokens.access_token).toBe("access_ok");
      expect(result.tokens.refresh_token).toBe("refresh_ok");
    }
    expect(call).toBe(2);
  });

  it("returns denied when provider reports access_denied", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })) as typeof fetch;
    const result = await pollGridOAuthToken(
      "https://trading.api.thegrid.ai",
      "agentsea-test",
      "device-code",
      0,
      30,
    );
    expect(result.status).toBe("denied");
  });

  it("refreshes an access token", async () => {
    let body = "";
    globalThis.fetch = (async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          access_token: "fresh_access",
          refresh_token: "fresh_refresh",
          token_type: "Bearer",
          expires_in: 1200,
          scope: "keys:manage",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const refreshed = await refreshGridOAuthToken("https://trading.api.thegrid.ai", "agentsea-test", "old_refresh");
    expect(body).toContain("refresh_token");
    expect(refreshed.access_token).toBe("fresh_access");
    expect(refreshed.refresh_token).toBe("fresh_refresh");
  });

  it("accepts refresh responses without refresh_token", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "fresh_access",
          token_type: "Bearer",
          expires_in: 1200,
          scope: "keys:manage",
        }),
        { status: 200 },
      )) as typeof fetch;

    const refreshed = await refreshGridOAuthToken("https://trading.api.thegrid.ai", "agentsea-test", "old_refresh");
    expect(refreshed.access_token).toBe("fresh_access");
    expect(refreshed.refresh_token).toBeUndefined();
  });

  it("throws when revoke fails", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 })) as typeof fetch;
    await expect(revokeGridOAuthToken("https://trading.api.thegrid.ai", "bad-token")).rejects.toThrow(
      /invalid_token/i,
    );
  });
});
