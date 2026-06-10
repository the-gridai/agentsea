import { describe, expect, it } from "bun:test";
import {
  CURSOR_PROXY_DOMAINS,
  CURSOR_PROXY_HTTPS_ENDPOINT,
  cursorCaddyInstallScript,
  cursorGridModelDisplayName,
  cursorHostsSetupScript,
  cursorProxyEnvFileScript,
} from "../shared/cursor-proxy.js";

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
  it("sources ~/.agentsearc instead of grepping bare KEY= lines", () => {
    const script = cursorProxyEnvFileScript();
    expect(script.includes(". ~/.agentsearc")).toBe(true);
    expect(script.includes("grep ^THEGRID_API_KEY=")).toBe(false);
    expect(script.includes("proxy.env")).toBe(true);
  });
});

describe("cursor proxy automation scripts", () => {
  it("exposes the HTTPS endpoint Cursor CLI expects after hosts spoofing", () => {
    expect(CURSOR_PROXY_HTTPS_ENDPOINT).toBe("https://api2.cursor.sh");
    expect(CURSOR_PROXY_DOMAINS).toContain("api2.cursor.sh");
  });

  it("installs Caddy with setcap for binding :443 without root", () => {
    const script = cursorCaddyInstallScript();
    expect(script).toContain("caddyserver.com/api/download");
    expect(script).toContain("cap_net_bind_service");
    expect(script).toContain("setcap");
  });

  it("writes /etc/hosts entries for all Cursor API hostnames", () => {
    const script = cursorHostsSetupScript();
    expect(script).toContain("api2.cursor.sh");
    expect(script).toContain("127.0.0.1");
    expect(script).toContain("hosts-spoof=ok");
    for (const domain of CURSOR_PROXY_DOMAINS) {
      expect(script).toContain(domain);
    }
  });
});
