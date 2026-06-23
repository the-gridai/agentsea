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
const listGridConsumptionKeysViaOAuthMock = mock(async () => [
  {
    id: "key-1",
    name: "agentsea-cli-abc",
    key_prefix: "sk-or-v1-aa",
    is_active: true,
    expires_at: null,
  },
]);
const createGridConsumptionKeyViaOAuthMock = mock(async (name: string) => ({
  id: "key-new",
  name,
  key_prefix: "sk-or-v1-bb",
  is_active: true,
  key: "sk-or-v1-secret-value",
}));
const revokeGridConsumptionKeyViaOAuthMock = mock(async (_id: string) => {});
const logAlwaysInfoMock = mock((_msg: string) => {});
const logAlwaysStepMock = mock((_msg: string) => {});

mock.module("../shared/oauth.js", () => ({
  loginWithGridOAuthAndKey: loginWithGridOAuthAndKeyMock,
  getGridOAuthStatus: getGridOAuthStatusMock,
  logoutGridOAuth: logoutGridOAuthMock,
  listGridConsumptionKeysViaOAuth: listGridConsumptionKeysViaOAuthMock,
  createGridConsumptionKeyViaOAuth: createGridConsumptionKeyViaOAuthMock,
  revokeGridConsumptionKeyViaOAuth: revokeGridConsumptionKeyViaOAuthMock,
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
    listGridConsumptionKeysViaOAuthMock.mockClear();
    createGridConsumptionKeyViaOAuthMock.mockClear();
    revokeGridConsumptionKeyViaOAuthMock.mockClear();
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
    expect(output).toContain("agentsea auth <login|status|logout|keys>");
    expect(output).toContain("agentsea auth login");
  });

  it("executes auth login flow", async () => {
    await cmdAuth(["login"]);
    expect(loginWithGridOAuthAndKeyMock).toHaveBeenCalledTimes(1);
    expect(logAlwaysStepMock).toHaveBeenCalledWith("Grid OAuth login complete.");
    expect(logAlwaysInfoMock).toHaveBeenCalledWith(
      "Saved OAuth session + consumption API key for future AgentSea runs.",
    );
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

  it("lists consumption keys via `auth keys`", async () => {
    await cmdAuth(["keys"]);
    expect(listGridConsumptionKeysViaOAuthMock).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(output).toContain("Grid consumption API keys");
    expect(output).toContain("agentsea-cli-abc");
    expect(output).toContain("key-1");
  });

  it("creates a key and prints the secret once via `auth keys create`", async () => {
    await cmdAuth(["keys", "create", "my-key"]);
    expect(createGridConsumptionKeyViaOAuthMock).toHaveBeenCalledWith("my-key");
    const output = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(output).toContain("sk-or-v1-secret-value");
    expect(logAlwaysInfoMock).toHaveBeenCalledWith("Copy this key now — the full secret is shown only once.");
  });

  it("defaults the key name when none is given on create", async () => {
    await cmdAuth(["keys", "create"]);
    expect(createGridConsumptionKeyViaOAuthMock).toHaveBeenCalledTimes(1);
    const calledName = createGridConsumptionKeyViaOAuthMock.mock.calls[0]?.[0] ?? "";
    expect(calledName).toMatch(/^agentsea-cli-/);
  });

  it("revokes a key by id via `auth keys revoke`", async () => {
    await cmdAuth(["keys", "revoke", "key-1"]);
    expect(revokeGridConsumptionKeyViaOAuthMock).toHaveBeenCalledWith("key-1");
    expect(logAlwaysStepMock).toHaveBeenCalledWith(expect.stringContaining("key-1"));
  });

  it("errors when `auth keys revoke` is missing an id", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error("process.exit");
    });
    await expect(cmdAuth(["keys", "revoke"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(revokeGridConsumptionKeyViaOAuthMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
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
    expect(output).toContain("agentsea auth keys");
    expect(output).toContain("AGENTSEA_GRID_OAUTH=0");
  });
});
