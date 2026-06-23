import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const loginWithGridOAuthAndKeyMock = mock(async () => "sk-or-v1-testkey");
const getGridOAuthStatusMock = mock(() => ({
  oauthConfigured: true,
  sessionPresent: true,
  expiresAt: "2099-01-01T00:00:00.000Z",
  scopes: ["account:read", "keys:manage"],
  hasKeysManageScope: true,
  hasSavedApiKey: true,
  oauthBaseUrl: "https://trading.api.thegrid.ai",
}));
const logoutGridOAuthMock = mock(async () => {});
const logAlwaysInfoMock = mock((_msg: string) => {});
const logAlwaysStepMock = mock((_msg: string) => {});

mock.module("../shared/oauth.js", () => ({
  loginWithGridOAuthAndKey: loginWithGridOAuthAndKeyMock,
  getGridOAuthStatus: getGridOAuthStatusMock,
  logoutGridOAuth: logoutGridOAuthMock,
}));

mock.module("../shared/ui.js", () => ({
  logAlwaysInfo: logAlwaysInfoMock,
  logAlwaysStep: logAlwaysStepMock,
}));

const { cmdAuth } = await import("../commands/auth.js");
const { cmdHelp } = await import("../commands/help.js");

describe("auth command surface", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loginWithGridOAuthAndKeyMock.mockClear();
    getGridOAuthStatusMock.mockClear();
    logoutGridOAuthMock.mockClear();
    logAlwaysInfoMock.mockClear();
    logAlwaysStepMock.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("shows usage when no subcommand is provided", async () => {
    await cmdAuth([]);
    const output = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(output).toContain("agentsea auth <login|status|logout>");
    expect(output).toContain("agentsea auth login");
  });

  it("executes auth login flow", async () => {
    await cmdAuth(["login"]);
    expect(loginWithGridOAuthAndKeyMock).toHaveBeenCalledTimes(1);
    expect(logAlwaysStepMock).toHaveBeenCalledWith("Grid OAuth login complete.");
    expect(logAlwaysInfoMock).toHaveBeenCalledWith("Saved OAuth session + consumption API key for future AgentSea runs.");
  });

  it("prints auth status details", async () => {
    await cmdAuth(["status"]);
    expect(getGridOAuthStatusMock).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(output).toContain("Grid OAuth status");
    expect(output).toContain("keys:manage");
    expect(output).toContain("provisioning OAuth auto-attempt");
  });

  it("executes auth logout flow", async () => {
    await cmdAuth(["logout"]);
    expect(logoutGridOAuthMock).toHaveBeenCalledTimes(1);
    expect(logAlwaysInfoMock).toHaveBeenCalledWith("Cleared local Grid OAuth session and saved key.");
  });

  it("exits with usage on unknown subcommand", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error("process.exit");
    });
    await expect(cmdAuth(["wat"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("help auth section", () => {
  it("includes auth subcommands and OAuth env guidance", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    cmdHelp();
    const output = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("agentsea auth login");
    expect(output).toContain("agentsea auth status");
    expect(output).toContain("agentsea auth logout");
    expect(output).toContain("AGENTSEA_GRID_OAUTH=0");
  });
});
