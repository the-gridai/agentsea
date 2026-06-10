// run-local-agent.ts — In-process local provider (no sh/local/*.sh or GitHub download)

import type { CloudOrchestrator } from "../shared/orchestrate.js";

import * as p from "@clack/prompts";
import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { makeDockerRunner, runOrchestration } from "../shared/orchestrate.js";
import { logWarn } from "../shared/ui.js";
import { resolveAgent } from "./agents.js";
import {
  cleanupContainer,
  dockerInteractiveSession,
  downloadFile,
  ensureDocker,
  interactiveSession,
  pullAndStartContainer,
  runLocal,
  startService,
  uploadFile,
} from "./local.js";

/** Provision and launch an agent on this machine (used by cli.js and local.js bundle). */
export async function runLocalAgent(agentName: string): Promise<void> {
  const betaFeatures = (process.env.AGENTSEA_BETA ?? "").split(",");
  const useSandbox = betaFeatures.includes("sandbox");

  const baseRunner = {
    runServer: runLocal,
    uploadFile: async (l: string, r: string) => uploadFile(l, r),
    downloadFile: async (r: string, l: string) => downloadFile(r, l),
    startService,
  };

  const agent = useSandbox
    ? createCloudAgentsFromModules(makeDockerRunner(baseRunner)).resolveAgent(agentName)
    : resolveAgent(agentName);

  if (useSandbox) {
    await ensureDocker();
  }

  const skipOpenClawLocalPrompt =
    process.env.AGENTSEA_NON_INTERACTIVE === "1" ||
    process.env.AGENTSEA_NONINTERACTIVE === "1" ||
    process.env.AGENTSEA_HEADLESS === "1";

  if (agentName === "openclaw" && !useSandbox && !skipOpenClawLocalPrompt) {
    process.stderr.write("\n");
    logWarn("⚠  Local installation warning");
    logWarn(`   This will install ${agent.name} directly on your machine.`);
    logWarn("   The agent will have full access to your filesystem, shell, and network.");
    logWarn("   For isolation, consider running on a cloud VM instead.\n");

    const confirmed = await p.confirm({
      message: "Continue with local installation?",
      initialValue: true,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Installation cancelled.");
      process.exit(0);
    }
  }

  const cloud: CloudOrchestrator = {
    cloudName: "local",
    cloudLabel: useSandbox ? "local (sandboxed)" : "local",
    capabilities: {
      localRuntime: true,
      disableSecurityScan: true,
    },
    skipAgentInstall: false,
    runner: useSandbox ? makeDockerRunner(baseRunner) : baseRunner,
    async authenticate() {},
    async promptSize() {},
    async createServer(_name: string) {
      return {
        ip: "localhost",
        user: process.env.USER || "local",
        cloud: "local",
      };
    },
    async getServerName() {
      const result = Bun.spawnSync(["hostname"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      return new TextDecoder().decode(result.stdout).trim() || "local";
    },
    async waitForReady() {
      if (useSandbox) {
        await pullAndStartContainer(agentName);
        cloud.skipAgentInstall = true;
      }
    },
    interactiveSession: useSandbox ? dockerInteractiveSession : interactiveSession,
  };

  if (useSandbox) {
    process.on("exit", cleanupContainer);
  }

  await runOrchestration(cloud, agent, agentName);
}
