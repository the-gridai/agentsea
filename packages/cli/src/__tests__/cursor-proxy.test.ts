import { describe, expect, it } from "bun:test";
import { cursorGridModelDisplayName, cursorProxyEnvFileScript } from "../shared/cursor-proxy.js";

describe("cursorGridModelDisplayName", () => {
  it("maps agent-standard to Agent Standard", () => {
    expect(cursorGridModelDisplayName("agent-standard")).toBe("Agent Standard");
  });

  it("humanizes provider-scoped catalogue ids", () => {
    expect(cursorGridModelDisplayName("openai/gpt-5.3-codex")).toBe("Gpt 5 3 Codex");
  });

  it("falls back for empty input", () => {
    expect(cursorGridModelDisplayName("")).toBe("Agent Standard");
    expect(cursorGridModelDisplayName("   ")).toBe("Agent Standard");
  });
});

describe("cursorProxyEnvFileScript", () => {
  it("sources ~/.spawnrc instead of grepping bare KEY= lines", () => {
    const script = cursorProxyEnvFileScript();
    expect(script.includes(". ~/.spawnrc")).toBe(true);
    expect(script.includes("grep ^THEGRID_API_KEY=")).toBe(false);
    expect(script.includes("proxy.env")).toBe(true);
  });
});
