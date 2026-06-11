/**
 * Static parity table: agent wiring must match The Grid integration docs.
 * Fails when agent-setup.ts or grid-instruments.ts drift from documented patterns.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCloudAgents, type CloudRunner } from "../../shared/agent-setup.js";
import {
  CLAUDE_GRID_FAMILY_ENV,
  resolveGridInstrumentProfile,
} from "../../shared/grid-instruments.js";
import { DEFAULT_GRID_INFERENCE_API_BASE } from "../../shared/grid-api.js";
import { KILO_GRID_PROVIDER_ID } from "../../shared/vendor-routing.js";
import { type E2eAgentSlug, E2E_AGENT_SLUGS } from "./e2e-agents.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const AGENT_SETUP_TS = join(REPO_ROOT, "packages", "cli", "src", "shared", "agent-setup.ts");
const VERIFY_SH = join(REPO_ROOT, "sh", "e2e", "lib", "verify.sh");

function captureRunner(): CloudRunner & { uploads: Map<string, string>; commands: string[] } {
  const uploads = new Map<string, string>();
  const commands: string[] = [];
  return {
    uploads,
    commands,
    runServer: async (cmd) => {
      commands.push(cmd);
    },
    uploadFile: async (localPath) => {
      uploads.set(localPath, readFileSync(localPath, "utf-8"));
    },
    downloadFile: async () => {},
  };
}

const noopRunner = captureRunner();
const { agents } = createCloudAgents(noopRunner);

type DocParityExpectation = {
  primaryInstrument: string;
  baseUrlFragment: string;
  forbiddenEnvFragments?: readonly string[];
  headlessSubcommand?: string;
  headlessModelFragment?: string;
};

const DOC_PARITY: Record<E2eAgentSlug, DocParityExpectation> = {
  claude: {
    primaryInstrument: CLAUDE_GRID_FAMILY_ENV.sonnet,
    baseUrlFragment: "messages-beta.api.thegrid.ai",
    headlessSubcommand: "claude --model",
  },
  openclaw: {
    primaryInstrument: resolveGridInstrumentProfile("openclaw").primary,
    baseUrlFragment: "messages-beta.api.thegrid.ai/v1",
    headlessSubcommand: "openclaw agent --agent main",
  },
  codex: {
    primaryInstrument: resolveGridInstrumentProfile("codex").primary,
    baseUrlFragment: "api.thegrid.ai/v1",
    headlessSubcommand: "codex exec",
  },
  opencode: {
    primaryInstrument: resolveGridInstrumentProfile("opencode").primary,
    baseUrlFragment: DEFAULT_GRID_INFERENCE_API_BASE,
    headlessSubcommand: "opencode run --dir",
    headlessModelFragment: "thegrid/code-prime",
  },
  kilocode: {
    primaryInstrument: resolveGridInstrumentProfile("kilocode").primary,
    baseUrlFragment: DEFAULT_GRID_INFERENCE_API_BASE,
    forbiddenEnvFragments: ["KILO_OPEN_ROUTER_API_KEY", "KILO_PROVIDER_TYPE", "opentouter"],
    headlessSubcommand: "kilocode run --model",
  },
  hermes: {
    primaryInstrument: resolveGridInstrumentProfile("hermes").primary,
    baseUrlFragment: "api.thegrid.ai/v1",
    forbiddenEnvFragments: ["127.0.0.1:4142"],
    headlessSubcommand: "hermes -z",
  },
  junie: {
    primaryInstrument: resolveGridInstrumentProfile("junie").primary,
    baseUrlFragment: "127.0.0.1",
    headlessSubcommand: "junie --project",
  },
  cursor: {
    primaryInstrument: resolveGridInstrumentProfile("cursor").primary,
    baseUrlFragment: "THEGRID_API_KEY",
    headlessSubcommand: "agent --endpoint https://api2.cursor.sh",
    headlessModelFragment: '--model "$GRID_MODEL_ID"',
  },
  pi: {
    primaryInstrument: resolveGridInstrumentProfile("pi").primary,
    baseUrlFragment: DEFAULT_GRID_INFERENCE_API_BASE,
    headlessSubcommand: "pi --print --provider thegrid",
  },
  t3code: {
    primaryInstrument: resolveGridInstrumentProfile("t3code").primary,
    baseUrlFragment: "api.thegrid.ai/v1",
  },
};

describe("grid doc parity (static expectations)", () => {
  describe.each([...E2E_AGENT_SLUGS])("agent %s", (slug) => {
    const spec = DOC_PARITY[slug];
    const agent = agents[slug];

    it("uses recommended primary instrument default", () => {
      expect(agent.modelDefault).toBe(spec.primaryInstrument);
    });

    it("envVars reference expected Grid base wiring", () => {
      const blob = agent.envVars("test-key").join("\n");
      expect(blob.includes(spec.baseUrlFragment) || blob.includes("THEGRID_API_KEY=test-key")).toBe(
        true,
      );
      for (const forbidden of spec.forbiddenEnvFragments ?? []) {
        expect(blob.includes(forbidden), `${slug}: forbidden env fragment ${forbidden}`).toBe(false);
      }
    });

    it("headless subcommand matches Grid integration doc", () => {
      if (!spec.headlessSubcommand) return;
      if (!agent.promptCmd) return;
      const cmd = agent.promptCmd!("ping");
      expect(cmd.includes(spec.headlessSubcommand), `${slug}: headless cmd missing ${spec.headlessSubcommand}`).toBe(
        true,
      );
      if (spec.headlessModelFragment) {
        expect(cmd.includes(spec.headlessModelFragment), `${slug}: headless cmd missing ${spec.headlessModelFragment}`).toBe(
          true,
        );
      }
    });
  });

  it("Kilo uses native thegrid provider id constant", () => {
    expect(KILO_GRID_PROVIDER_ID).toBe("thegrid");
    expect(agents.kilocode.configure).toBeDefined();
  });

  it("Claude uses messages-beta base and auth-token env wiring", () => {
    const blob = agents.claude.envVars("test-key").join("\n");
    expect(blob).toContain("messages-beta.api.thegrid.ai");
    expect(blob).toContain("ANTHROPIC_AUTH_TOKEN=test-key");
    expect(blob).toContain(`ANTHROPIC_MODEL=agent-standard`);
    expect(blob).not.toContain("ANTHROPIC_API_KEY=test-key");
  });

  it("Hermes setup applies redirect patch with grep count=1 verification", () => {
    const src = readFileSync(AGENT_SETUP_TS, "utf-8");
    expect(src).toContain("agentsea-grid-redirect-patch.sh");
    expect(src).toContain("hermesUpdateShellCmd");
    expect(src).toContain("_build_keepalive_http_client");
    expect(src).toContain('grep -c "follow_redirects=True"');
    expect(src).toContain('api_key: ${THEGRID_API_KEY}');
    expect(src).toContain("supports_vision: false");
    expect(src).toContain("resolveGridInstrumentModelSpec");
  });

  it("OpenClaw merge script registers per-instrument context and text input", () => {
    const src = readFileSync(AGENT_SETUP_TS, "utf-8");
    expect(src).toContain("cfg.models.mode = 'merge'");
    expect(src).toContain("modelSpecs");
    expect(src).toContain("input: spec.input");
    expect(src).toContain("contextWindow: spec.contextWindow");
  });

  it("verify.sh enforces Grid doc parity for all enabled agents", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    for (const slug of E2E_AGENT_SLUGS) {
      expect(verifySh).toContain(`input_test_${slug}()`);
      expect(verifySh).toContain(`verify_${slug}()`);
    }
    expect(verifySh).toContain("messages-beta.api.thegrid.ai");
    expect(verifySh).toContain('models.mode is merge');
    expect(verifySh).toContain("api_key:");
    expect(verifySh).toContain("THEGRID_API_KEY");
    expect(verifySh).toContain('follow_redirects=True patch (count=1)');
    expect(verifySh).toContain("--model thegrid/code-prime");
    expect(verifySh).toContain("--agent main --session-key agentsea-e2e");
  });
});

describe("grid doc parity (configure uploads)", () => {
  it("Hermes configure uploads config.yaml with api_key interpolation", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.hermes.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain("api.thegrid.ai");
    expect(uploaded).toContain("api_key: ${THEGRID_API_KEY}");
    expect(uploaded).toContain("provider: custom");
    expect(uploaded).toContain("default: agent-prime");
    expect(uploaded).toContain("context_length: 128000");
    expect(uploaded).toContain("supports_vision: false");
    expect(uploaded).toContain("model_aliases:");
    expect(uploaded).toContain("agent_standard:");
    expect(uploaded).toContain("model: agent-standard");
    expect(uploaded).toContain("agent_max:");
    expect(uploaded).toContain("auxiliary:");
    expect(uploaded).toContain("compression:");
    expect(uploaded).toContain("follow_redirects=True");
    expect(runner.commands.some((c) => c.includes("agentsea-grid-redirect-patch.sh"))).toBe(true);
  });

  it("OpenCode configure uploads thegrid provider in opencode.json", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.opencode.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain('"thegrid"');
    expect(uploaded).toContain("api.thegrid.ai");
    expect(uploaded).toContain("code-prime");
    expect(uploaded).toContain('"context": 128000');
    expect(uploaded).toContain('"modalities"');
    expect(uploaded).toContain('"text"');
  });

  it("Pi configure uploads per-instrument context and modalities", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.pi.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain('"contextWindow": 128000');
    expect(uploaded).toContain('"input"');
    expect(uploaded).toContain('"text"');
    expect(uploaded).toContain("code-prime");
  });

  it("Codex configure uploads chat wire_api against direct Grid API", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.codex.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain("api.thegrid.ai/v1");
    expect(uploaded).toContain('wire_api = "chat"');
    expect(uploaded).not.toContain('wire_api = "responses"');
    expect(uploaded).toContain("[model_providers.thegrid]");
  });

  it("Kilo configure uploads native thegrid provider without OpenRouter keys", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.kilocode.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain('"thegrid"');
    expect(uploaded).toContain("api.thegrid.ai");
    expect(uploaded).toContain("agent-prime");
    expect(uploaded).toContain('"tool_call": true');
    expect(uploaded).toContain('"context": 128000');
    expect(uploaded).not.toContain("KILO_OPEN_ROUTER_API_KEY");
    expect(uploaded).not.toContain("opentouter");
  });

  it("Claude configure uploads messages-beta base URL in settings.json", async () => {
    const runner = captureRunner();
    const { agents: localAgents } = createCloudAgents(runner);
    await localAgents.claude.configure!("test-key");
    const uploaded = [...runner.uploads.values()].join("\n");
    expect(uploaded).toContain("messages-beta.api.thegrid.ai");
    expect(uploaded).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(uploaded).toContain("agent-standard");
  });
});
