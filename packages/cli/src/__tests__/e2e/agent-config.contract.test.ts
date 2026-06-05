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
import { type E2eAgentSlug, E2E_AGENT_SLUGS } from "./e2e-agents.js";

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
    "OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai/v1",
    "OPENAI_API_KEY=test-key",
  ],
  codex: [
    "THEGRID_API_KEY=test-key",
    "OPENAI_API_KEY=test-key",
    "OPENAI_BASE_URL=https://api.thegrid.ai/v1",
  ],
  opencode: ["THEGRID_API_KEY=test-key"],
  kilocode: ["THEGRID_API_KEY=test-key", "KILO_OPEN_ROUTER_API_KEY=test-key"],
  hermes: ["THEGRID_API_KEY=test-key", "OPENAI_BASE_URL=http://127.0.0.1:4142/v1", "OPENAI_API_KEY=test-key"],
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
    const expected = [...E2E_AGENT_SLUGS].sort();
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
    expect(agents.claude.modelDefault).toBe("agent-standard");
    expect(agents.claude.modelEnvVar).toBe("ANTHROPIC_MODEL");
    expect(agents.claude.launchCmd().includes('--model "$ANTHROPIC_MODEL"')).toBe(true);
    expect(agents.claude.promptCmd?.("ping").includes('--model "$ANTHROPIC_MODEL"')).toBe(true);
  });

  it("cursor exposes model picker wiring for Grid catalogue ids in the local proxy", () => {
    expect(agents.cursor.modelDefault).toBe("agent-standard");
    expect(agents.cursor.modelEnvVar).toBe("GRID_MODEL_ID");
  });

  it("hermes targets The Grid via custom provider config (not OpenRouter defaults)", () => {
    expect(agents.hermes.modelDefault).toBe("agent-standard");
    expect(agents.hermes.modelEnvVar).toBe("LLM_MODEL");
    expect(typeof agents.hermes.configure).toBe("function");
  });

  it("junie targets The Grid via ~/.junie custom model profile (skip auth wizard)", () => {
    expect(agents.junie.modelDefault).toBe("agent-standard");
    expect(typeof agents.junie.configure).toBe("function");
    expect(typeof agents.junie.preLaunch).toBe("function");
    expect(agents.junie.launchCmd().includes("JUNIE_MODEL=custom:thegrid")).toBe(true);
    expect(agents.junie.promptCmd?.("ping").includes("JUNIE_MODEL=custom:thegrid")).toBe(true);
  });

  it("junie avoids direct api.thegrid.ai in custom profile baseUrl (307 synapse redirect)", () => {
    const profile = buildJunieGridModelProfile("test-key");
    expect(profile.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(profile.baseUrl.endsWith("/v1/chat/completions")).toBe(true);
    expect(profile.baseUrl.includes("api.thegrid.ai")).toBe(false);
  });

  it("pi targets The Grid via models.json + settings.json (not built-in provider keys)", () => {
    expect(agents.pi.modelDefault).toBe("agent-standard");
    expect(typeof agents.pi.configure).toBe("function");
  });

  it("opencode targets The Grid via a custom provider config (not built-in providers)", () => {
    // Without a configure step OpenCode routes the Grid key to its default
    // provider and 403s with "Forbidden: blocked by a gateway or proxy" (#21).
    expect(agents.opencode.modelDefault).toBe("agent-standard");
    expect(typeof agents.opencode.configure).toBe("function");
  });

  it("t3code installs Codex CLI and routes it to The Grid via LiteLLM proxy", () => {
    expect(agents.t3code.modelDefault).toBe("agent-standard");
    expect(typeof agents.t3code.configure).toBe("function");
    expect(typeof agents.t3code.preLaunch).toBe("function");
    expect(agents.t3code.launchCmd().includes("4141/health/liveliness")).toBe(true);
    expect(agents.t3code.launchCmd().includes("npm-global/bin")).toBe(true);
    const blob = agents.t3code.envVars("test-key").join("\n");
    expect(blob.includes("THEGRID_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_API_KEY=test-key")).toBe(true);
  });

  it("hermes avoids direct api.thegrid.ai chat/completions (307 synapse redirect)", () => {
    const lines = agents.hermes.envVars("test-key");
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=http://127.0.0.1:4142/v1"))).toBe(true);
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://api.thegrid.ai/v1"))).toBe(false);
  });

  it("codex configures LiteLLM responses bridge for Grid chat/completions", () => {
    const blob = agents.codex.envVars("test-key").join("\n");
    expect(blob.includes("THEGRID_API_KEY=test-key")).toBe(true);
    expect(blob.includes("OPENAI_API_KEY=test-key")).toBe(true);
  });

  it("openclaw avoids api.thegrid.ai OpenAI redirect surface (SSRF synapse block)", () => {
    const lines = agents.openclaw.envVars("test-key");
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://messages-beta.api.thegrid.ai/v1"))).toBe(true);
    expect(lines.some((l) => l.startsWith("OPENAI_BASE_URL=https://api.thegrid.ai/v1"))).toBe(false);
  });

  it("resolveAgent rejects unknown slugs", () => {
    expect(() => resolveAgent("not-an-agent")).toThrow(/Unknown agent/);
  });
});
