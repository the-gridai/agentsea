import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { resetGridApiKeyValidationCacheForTests, verifyTheGridApiKey } from "../shared/oauth.js";

const VALID_KEY = `sk-or-v1-${"c".repeat(64)}`;
const OTHER_VALID_KEY = `sk-or-v1-${"d".repeat(64)}`;

describe("verifyTheGridApiKey validation cache", () => {
  let fetchCalls = 0;
  const prevSkip = process.env.AGENTSEA_SKIP_API_VALIDATION;
  const prevApiKey = process.env.THEGRID_API_KEY;
  const prevIsTTY = process.stderr.isTTY;

  beforeEach(() => {
    fetchCalls = 0;
    delete process.env.AGENTSEA_SKIP_API_VALIDATION;
    delete process.env.THEGRID_API_KEY;
    resetGridApiKeyValidationCacheForTests();
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    global.fetch = mock(() => {
      fetchCalls++;
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
  });

  afterEach(() => {
    resetGridApiKeyValidationCacheForTests();
    if (prevSkip !== undefined) {
      process.env.AGENTSEA_SKIP_API_VALIDATION = prevSkip;
    } else {
      delete process.env.AGENTSEA_SKIP_API_VALIDATION;
    }
    if (prevApiKey !== undefined) {
      process.env.THEGRID_API_KEY = prevApiKey;
    } else {
      delete process.env.THEGRID_API_KEY;
    }
    Object.defineProperty(process.stderr, "isTTY", { value: prevIsTTY, configurable: true });
  });

  it("skips repeat network validation for the same key within TTL", async () => {
    expect(await verifyTheGridApiKey(VALID_KEY)).toBe(true);
    expect(await verifyTheGridApiKey(VALID_KEY)).toBe(true);
    expect(fetchCalls).toBe(1);
  });

  it("re-validates when the key changes", async () => {
    await verifyTheGridApiKey(VALID_KEY);
    await verifyTheGridApiKey(OTHER_VALID_KEY);
    expect(fetchCalls).toBe(2);
  });

  it("honors AGENTSEA_SKIP_API_VALIDATION without calling fetch", async () => {
    process.env.AGENTSEA_SKIP_API_VALIDATION = "1";
    expect(await verifyTheGridApiKey(VALID_KEY)).toBe(true);
    expect(fetchCalls).toBe(0);
  });

  it("rejects malformed keys before any network call", async () => {
    expect(await verifyTheGridApiKey("too-short")).toBe(false);
    expect(fetchCalls).toBe(0);
  });
});
