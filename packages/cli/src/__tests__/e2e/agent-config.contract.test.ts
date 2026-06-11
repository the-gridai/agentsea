/**
 * Fast contract tests for createCloudAgents (no cloud, no SSH).
 * For real provision + verify on DigitalOcean, see digitalocean-agent-flows.test.ts
 * when GRIDAGENTSEA_RUN_DO_E2E=1 and credentials are set.
 */
import { describe, expect, it } from "bun:test";
import type { AgentConfig } from "../../shared/agents.js";
import { createCloudAgents, type CloudRunner } from "../../shared/agent-setup.js";
import { createCloudAgentsFromModules } from "../../shared/agent-module-registry.js";
import { buildJunieGridModelProfile } from "../../shared/junie-config.js";
import { CODEX_CLI_GRID_PINNED_VERSION } from "../../shared/vendor-routing.js";
import { type E2eAgentSlug, E2E_AGENT_SLUGS, E2E_DISABLED_AGENT_SLUGS } from "./e2e-agents.js";

const ALL_E2E_AGENT_SLUGS = [...E2E_AGENT_SLUGS, ...E2E_DISABLED_AGENT_SLUGS] as const;

const noopRunner: CloudRunner = {
  runServer: async () => {},
  uploadFile: async () => {},
  downloadFile: async () => {},
};

const { agents, resolveAgent } = createCloudAgents(noopRunner);
const { agents: moduleAgents } = createCloudAgentsFromModules(noopRunner);

function assertAgentseaRcEnvLines(lines: string[], slug: string): void {
  expect(lines.length, `${slug}: envVars should not be empty`).toBeGreaterThan(0);
  for (const line of lines) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    expect(m, `${slug}: invalid env line: ${JSON.stringify(line)}`).not.toBeNull();
  }
}

const GRID_ENV_SUBSTRINGS: Record<E2eAgentSlug, string[]> = {
  claude: [
    "THEGRID_API_KEY=test-key",
    "ANTHROPIC_BASE_URL=https://messages-beta.api.thegrid.ai",
    "ANTHROPIC_MODEL=agent-standard",
    "ANTHROPIC_AUTH_TOKEN=test-key",
  ],
  openclaw: [
    "THEGRID_API_KEY=test-key",
    "OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai",
    "OPENAI_API_KEY=test-key",
  ],
  codex: [
    "THEGRID_API_KEY=test-key",
    "OPENAI_API_KEY=test-key",
    "OPENAI_BASE_URL=https://api.thegrid.ai/v1",
  ],
  opencode: ["THEGRID_API_KEY=test-key"],
  kilocode: ["THEGRID_API_KEY=test-key"],
  hermes: [
    "THEGRID_API_KEY=test-key",
    "OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai",
    "OPENAI_API_KEY=test-key",
  ],
  junie: ["JUNIE_THEGRID_API_KEY=test-key", "THEGRID_API_KEY=test-key"],
  cursor: ["THEGRID_API_KEY=test-key", "CURSOR_API_KEY=test-key"],
  pi: ["THEGRID_API_KEY=test-key"],
  t3code: [
    "THEGRID_API_KEY=test-key",
    "ANTHROPIC_BASE_URL=https://messages-beta.api.thegrid.ai",
    "OPENAI_BASE_URL=https://api.thegrid.ai/v1",
  ],
};

function assertHeadlessPrompt(agent: AgentConfig, slug: E2eAgentSlug): void {
  if (slug === "t3code") {
    expect(agent.promptCmd, "t3code is GUI/tunnel-oriented; headless promptCmd omitted").toBeUndefined();
    return;
  }
  expect(typeof agent.promptCmd, `${slug}: promptCmd required for headless --prompt`).toBe("function");
  const sample = 'Reply with OK.\nSecond: echo "x"';
  const cmd = agent.promptCmd!(sample);
  expect(cmd.length, `${slug}: promptCmd output empty`).toBeGreaterThan(10);
  expect(cmd.includes("source ~/.agentsearc"), `${slug}: prompt should source ~/.agentsearc`).toBe(true);
}

describe("agent config contract (createCloudAgents, no cloud)", () => {
  it("exposes the same agent slugs as E2E ALL_AGENTS", () => {
    const keys = Object.keys(agents).sort();
    const expected = [...ALL_E2E_AGENT_SLUGS].sort();
    expect(keys).toEqual(expected);
    expect(Object.keys(moduleAgents).sort()).toEqual(expected);
  });

  describe.each([...E2E_AGENT_SLUGS])("agent %s", (slug) => {
    it("resolveAgent returns a usable AgentConfig", () => {
      const a = resolveAgent(slug);
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.install).toBe("function");
      expect(typeof a.envVars).toBe("function");
      expect(typeof a.launchCmd).toBe("function");
    });

    it("envVars produces valid .agentsearc pairs and expected Grid wiring", () => {
      const apiKey = "test-key";
      const lines = agents[slug].envVars(apiKey);
      const blob = lines.join("\n");
      assertAgentseaRcEnvLines(lines, slug);
      for (const frag of GRID_ENV_SUBSTRINGS[slug]) {
        expect(blob.includes(frag), `${slug}: env missing ${frag}`).toBe(true);
      }
    });

    it("launchCmd is non-empty shell", () => {
      const cmd = agents[slug].launchCmd();
      expect(cmd.length).toBeGreaterThan(5);
    });

    it("headless prompt command policy", () => {
      assertHeadlessPrompt(agents[slug], slug);
    });
  });

  it("claude exposes model picker wiring to avoid stale unsupported defaults", () => {
    expect(agents.claude.modelDefault).toBe("text-prime");
    expect(agents.claude.modelEnvVar).toBe("ANTHROPIC_MODEL");
    expect(agents.claude.launchCmd().includes('--model "$ANTHROPIC_MODEL"')).toBe(true);
    expect(agents.claude.promptCmd?.("ping").includes('--model "$ANTHROPIC_MODEL"')).toBe(true);
  });

  it("cursor exposes model picker wiring for Grid catalogue ids in the local proxy", () => {
    expect(agents.cursor.modelDefault).toBe("code-prime");
    expect(agents.cursor.modelEnvVar).toBe("GRID_MODEL_ID");
  });

  it("hermes targets The Grid via custom provider config (not OpenRouter defaults)", () => {
    expect(agents.hermes.modelDefault).toBe("agent-prime");
    expect(agents.hermes.modelEnvVar).toBe("LLM_MODEL");
    expect(typeof agents.hermes.configure).toBe("function");
  });

  it("hermes auto-update reinstalls from upstream only (messages-beta needs no source patch)", () => {
    expect(agents.hermes.updateCmd).toContain("install.sh");
    expect(agents.hermes.updateCmd).not.toContain("agentsea-grid-redirect-patch.sh");
  });

  it("junie targets The Grid via ~/.junie custom model profile (skip auth wizard)", () => {
    expect(agents.junie.modelDefault).toBe("code-prime");
    expect(typeof agents.junie.configure).toBe("function");
    expect(typeof agents.junie.preLaunch).toBe("function");
    expect(agents.junie.launchCmd().includes("JUNIE_MODEL=custom:thegrid")).toBe(true);
    expect(agents.junie.promptCmd?.("ping").includes("JUNIE_MODEL=custom:thegrid")).toBe(true);
  });

  it("junie routes via local grid-chat-proxy (redirect-following upstream)", () => {
    const profile = buildJunieGridModelProfile("test-key");
    expect(profile.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(profile.baseUrl.endsWith("/v1/chat/completions")).toBe(true);
    expect(typeof agents.junie.preLaunch).toBe("function");
  });

  it("pi targets The Grid via models.json + settings.json (not built-in provider keys)", () => {
    expect(agents.pi.modelDefault).toBe("code-prime");
    expect(typeof agents.pi.configure).toBe("function");
  });

  it("opencode targets The Grid via a custom provider config (not built-in providers)", () => {
    // Without a configure step OpenCode routes the Grid key to its default
    // provider and 403s with "Forbidden: blocked by a gateway or proxy" (#21).
    expect(agents.opencode.modelDefault).toBe("code-prime");
    expect(typeof agents.opencode.configure).toBe("function");
  });

  it("t3code installs Codex CLI and wires Grid auth via .agentsearc", () => {
    expect(agents.t3code.modelDefault).toBe("code-prime");
    expect(typeof agents.t3code.configure).toBe("function");
    expect(agents.t3code.preLaunch).toBeUndefined();
    expect(agents.t3code.launchCmd().includes("npm-global/bin")).toBe(true);
    const blob = agents.t3code.envVars("test-key").join("\n");
    expect(blob.includes("THEGRID_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_BASE_URL=https://api.thegrid.ai/v1")).toBe(true);
  });

  it("hermes uses messages-beta (no api.thegrid.ai redirect, no local proxy on :4142)", () => {
    const lines = agents.hermes.envVars("test-key");
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai"))).toBe(true);
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai/v1"))).toBe(false);
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://api.thegrid.ai/v1"))).toBe(false);
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=http://127.0.0.1:4142/v1"))).toBe(false);
  });

  it("codex points at direct Grid API (no local proxy)", () => {
    const blob = agents.codex.envVars("test-key").join("\n");
    expect(blob.includes("THEGRID_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_BASE_URL=https://api.thegrid.ai/v1")).toBe(true);
    expect(typeof agents.codex.configure).toBe("function");
    expect(agents.codex.preLaunch).toBeUndefined();
  });

  it("openclaw uses messages-beta /v1 base for SSRF-safe provider wiring", () => {
    const lines = agents.openclaw.envVars("test-key");
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai/v1"))).toBe(true);
  });

  it("headless wrappers use documented subcommands", () => {
    const opencodeCmd = agents.opencode.promptCmd?.("x") ?? "";
    expect(opencodeCmd.includes("opencode run --dir")).toBe(true);
    expect(opencodeCmd.includes("thegrid/code-prime")).toBe(true);
    expect(opencodeCmd.includes("$HOME/.opencode/bin")).toBe(true);
    expect(opencodeCmd.includes("opencode --prompt")).toBe(false);
    expect(agents.opencode.launchCmd().includes("$HOME/.opencode/bin")).toBe(true);
    expect(agents.openclaw.promptCmd?.("x").includes("openclaw agent --agent main")).toBe(true);
    expect(agents.openclaw.promptCmd?.("x").includes("--session-key 'agentsea-e2e'")).toBe(true);
    expect(agents.openclaw.promptCmd?.("x").includes("--message 'x'")).toBe(true);
    expect(agents.openclaw.promptCmd?.("x").includes("--timeout 240 --json")).toBe(true);
    expect(agents.openclaw.promptCmd?.("x").includes("openclaw run")).toBe(false);
    expect(agents.pi.promptCmd?.("x").includes("pi --print --provider thegrid")).toBe(true);
    expect(agents.pi.promptCmd?.("x").includes("--no-session")).toBe(true);
    expect(agents.pi.promptCmd?.("x").includes("pi --prompt")).toBe(false);
    expect(agents.junie.promptCmd?.("x").includes("junie --project")).toBe(true);
    expect(agents.junie.promptCmd?.("x").includes("--task 'x'")).toBe(true);
    expect(agents.junie.promptCmd?.("x").includes("--timeout 240000 --skip-update-check")).toBe(true);
    expect(agents.junie.promptCmd?.("x").includes("junie --prompt")).toBe(false);
    expect(agents.hermes.promptCmd?.("x").includes("hermes -z")).toBe(true);
    expect(agents.hermes.promptCmd?.("x").includes("--provider custom:thegrid")).toBe(true);
    expect(agents.hermes.promptCmd?.("x").includes("--yolo")).toBe(true);
    expect(agents.hermes.promptCmd?.("x").includes("-m 'agent-prime'")).toBe(true);
    expect(agents.hermes.promptCmd?.("x").includes("hermes 'x'")).toBe(false);
    expect(agents.kilocode.promptCmd?.("x").includes("kilocode run --model")).toBe(true);
    expect(agents.kilocode.promptCmd?.("x").includes("thegrid/agent-prime")).toBe(true);
    expect(agents.kilocode.promptCmd?.("x").includes("kilocode --prompt")).toBe(false);
    expect(typeof agents.kilocode.configure).toBe("function");
    expect(agents.cursor.promptCmd?.("x").includes("agent --endpoint https://api2.cursor.sh")).toBe(true);
    expect(agents.cursor.promptCmd?.("x").includes("--print --trust --force --sandbox disabled")).toBe(true);
    expect(agents.cursor.promptCmd?.("x").includes('--model "$GRID_MODEL_ID"')).toBe(true);
    expect(agents.cursor.promptCmd?.("x").includes("--prompt")).toBe(false);
  });

  it("codex pins CLI version and uses chat wire_api for Grid chat/completions", () => {
    expect(agents.codex.install.toString()).toContain("CODEX_CLI_GRID_PINNED_VERSION");
    expect(agents.codex.updateCmd).toContain(`@openai/codex@${CODEX_CLI_GRID_PINNED_VERSION}`);
    expect(agents.codex.updateCmd).not.toContain("@openai/codex@latest");
  });

  it("resolveAgent rejects unknown slugs", () => {
    expect(() => resolveAgent("not-an-agent")).toThrow(/Unknown agent/);
  });
});
