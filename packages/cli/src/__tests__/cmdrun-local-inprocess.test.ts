import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createMockManifest, mockClackPrompts, restoreMocks } from "./test-helpers.js";

const runLocalAgentMock = mock(async (_agent: string) => {});

mock.module("../local/run-local-agent.js", () => ({
  runLocalAgent: runLocalAgentMock,
}));

const mockManifest = createMockManifest();
mockClackPrompts();

const { execScript } = await import("../commands/run.js");

describe("execScript local in-process", () => {
  let historyDir: string;
  let fetchCalls: string[] = [];
  const originalFetch = global.fetch;

  beforeEach(() => {
    historyDir = join(process.env.HOME ?? "", `agentsea-local-inprocess-${Date.now()}`);
    mkdirSync(historyDir, { recursive: true });
    process.env.AGENTSEA_HOME = historyDir;
    runLocalAgentMock.mockClear();
    fetchCalls = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      fetchCalls.push(urlStr);
      if (urlStr.includes("manifest.json")) {
        return new Response(JSON.stringify(mockManifest));
      }
      throw new Error(`unexpected fetch: ${urlStr}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AGENTSEA_HOME;
    restoreMocks();
    if (existsSync(historyDir)) {
      rmSync(historyDir, { recursive: true, force: true });
    }
  });

  it("runs local cloud in-process without downloading sh/local scripts", async () => {
    const ok = await execScript("local", "claude");
    expect(ok).toBe(true);
    expect(runLocalAgentMock).toHaveBeenCalledTimes(1);
    expect(runLocalAgentMock.mock.calls[0]?.[0]).toBe("claude");
    expect(fetchCalls.some((u) => u.includes("/local/claude.sh"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("raw.githubusercontent.com"))).toBe(false);
  });
});
