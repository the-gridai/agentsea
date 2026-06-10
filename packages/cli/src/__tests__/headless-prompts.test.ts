import { describe, expect, it } from "bun:test";
import { generateEnvConfig } from "../shared/agents.js";
import {
  cursorHeadlessPrompt,
  hermesHeadlessPrompt,
  junieHeadlessPrompt,
  kilocodeHeadlessPrompt,
  OPENCLAW_HEADLESS_SESSION_KEY,
  OPENCODE_LAUNCH_SHELL_PREFIX,
  openclawHeadlessPrompt,
  opencodeHeadlessPrompt,
  piHeadlessPrompt,
  toolE2ePrompt,
  wrapHeadlessPromptCmd,
} from "../shared/headless-prompts.js";
import { JUNIE_LAUNCH_SHELL_PREFIX } from "../shared/junie-config.js";
import { KILO_GRID_PROVIDER_ID, OPENCLAW_GRID_PROVIDER_ID } from "../shared/vendor-routing.js";

describe("openclaw headless prompts", () => {
  it("builds openclaw agent with session key, message, timeout, and json", () => {
    const cmd = openclawHeadlessPrompt("do the thing");
    expect(cmd).toContain("source ~/.agentsearc");
    expect(cmd).toContain("$HOME/.npm-global/bin");
    expect(cmd).toContain("openclaw agent --agent main");
    expect(cmd).toContain(`--session-key '${OPENCLAW_HEADLESS_SESSION_KEY}'`);
    expect(cmd).toContain("--message 'do the thing'");
    expect(cmd).toContain("--timeout 240 --json");
    expect(cmd).not.toContain("openclaw run");
  });

  it("wrapHeadlessPromptCmd validates openclaw JSON winner fields", () => {
    const wrapped = wrapHeadlessPromptCmd(openclawHeadlessPrompt("ping"));
    expect(wrapped).toContain('"winnerProvider"');
    expect(wrapped).toContain('"thegrid"');
    expect(wrapped).toContain('"winnerModel"');
  });

  it("wrapHeadlessPromptCmd propagates non-zero exit codes", () => {
    const wrapped = wrapHeadlessPromptCmd("false");
    expect(wrapped).toContain("ec=$?");
    expect(wrapped).toContain("exit $ec");
  });
});

describe("opencode headless prompts", () => {
  it("exports launch shell prefix with ~/.opencode/bin on PATH", () => {
    expect(OPENCODE_LAUNCH_SHELL_PREFIX).toContain("source ~/.agentsearc");
    expect(OPENCODE_LAUNCH_SHELL_PREFIX).toContain("$HOME/.opencode/bin");
    expect(OPENCODE_LAUNCH_SHELL_PREFIX).not.toContain("/tmp/opencode");
  });

  it("builds opencode run with model and permissions flags", () => {
    const cmd = opencodeHeadlessPrompt("do the thing", "code-prime");
    expect(cmd).toContain("opencode run --dir");
    expect(cmd).toContain(`--model '${OPENCLAW_GRID_PROVIDER_ID}/code-prime'`);
    expect(cmd).toContain("--dangerously-skip-permissions");
    expect(cmd).toContain("'do the thing'");
    expect(cmd).not.toContain("opencode --prompt");
  });

  it("uses opencode on PATH (no hardcoded binary path)", () => {
    const cmd = opencodeHeadlessPrompt("ping", "code-prime");
    expect(cmd).toMatch(/\bopencode run\b/);
    expect(cmd).not.toMatch(/\/\.opencode\/bin\/opencode/);
  });
});

describe("pi headless prompts", () => {
  it("builds pi --print with thegrid provider, model, and no-session", () => {
    const cmd = piHeadlessPrompt("do the thing", "agent-standard");
    expect(cmd).toContain("source ~/.agentsearc");
    expect(cmd).toContain("source ~/.zshrc");
    expect(cmd).toContain(`pi --print --provider ${OPENCLAW_GRID_PROVIDER_ID}`);
    expect(cmd).toContain("--model 'agent-standard' --no-session");
    expect(cmd).toContain("'do the thing'");
    expect(cmd).not.toContain("pi --prompt");
  });
});

describe("junie headless prompts", () => {
  it("builds junie --project with --task and JUNIE_MODEL prefix", () => {
    const cmd = junieHeadlessPrompt("do the thing");
    expect(cmd).toContain(JUNIE_LAUNCH_SHELL_PREFIX);
    expect(cmd).toContain('junie --project "$PWD"');
    expect(cmd).toContain("--task 'do the thing'");
    expect(cmd).toContain("--timeout 240000 --skip-update-check");
    expect(cmd).not.toContain("junie --prompt");
  });
});

describe("hermes headless prompts", () => {
  it("builds hermes -z one-shot with custom provider, model, and yolo", () => {
    const cmd = hermesHeadlessPrompt("do the thing", "agent-prime");
    expect(cmd).toContain("source ~/.agentsearc");
    expect(cmd).toContain("$HOME/.hermes/hermes-agent/venv/bin");
    expect(cmd).toContain("hermes -z 'do the thing'");
    expect(cmd).toContain("--provider custom");
    expect(cmd).toContain("-m 'agent-prime'");
    expect(cmd).toContain("--yolo");
    expect(cmd).not.toMatch(/\bhermes 'do the thing'/);
  });
});

describe("cursor headless prompts", () => {
  it("builds agent --print with trust, force, sandbox disabled, and Grid model", () => {
    const cmd = cursorHeadlessPrompt(toolE2ePrompt());
    expect(cmd).toContain("source ~/.agentsearc");
    expect(cmd).toContain("agent --endpoint https://api2.cursor.sh");
    expect(cmd).toContain("--print --trust --force --sandbox disabled");
    expect(cmd).toContain('--workspace "$HOME"');
    expect(cmd).toContain('--model "$GRID_MODEL_ID"');
    expect(cmd).toContain("TOOL_E2E_OK");
    expect(cmd).not.toContain("--prompt");
  });
});

describe("kilocode headless prompts", () => {
  it("builds kilocode run with thegrid provider and model id", () => {
    const cmd = kilocodeHeadlessPrompt("do the thing", "agent-prime");
    expect(cmd).toContain("source ~/.agentsearc");
    expect(cmd).toContain("source ~/.zshrc");
    expect(cmd).toContain(`kilocode run --model '${KILO_GRID_PROVIDER_ID}/agent-prime'`);
    expect(cmd).toContain("'do the thing'");
    expect(cmd).not.toContain("kilocode --prompt");
  });

  it("wrapHeadlessPromptCmd validates kilocode output for inference errors", () => {
    const wrapped = wrapHeadlessPromptCmd(kilocodeHeadlessPrompt("ping", "agent-prime"));
    expect(wrapped).toContain("model not found");
    expect(wrapped).toContain("kilocode produced no output");
    expect(wrapped).toContain("AGENTSEA_PROMPT_FAILED");
  });
});

describe("generateEnvConfig PATH", () => {
  it("includes ~/.opencode/bin for agentsearc sourcing", () => {
    const env = generateEnvConfig(["THEGRID_API_KEY=test-key"]);
    expect(env).toContain("$HOME/.opencode/bin");
  });
});
