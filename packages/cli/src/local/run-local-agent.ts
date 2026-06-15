// run-local-agent.ts — In-process local provider (no sh/local/*.sh or GitHub download)

import type { CloudOrchestrator } from "../shared/orchestrate.js";

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { pickToTTY } from "../picker.js";
import { makeDockerRunner, runOrchestration } from "../shared/orchestrate.js";
import { logInfo, logWarn } from "../shared/ui.js";
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

    // Read the confirm straight from /dev/tty (pickToTTY) rather than via Clack's
    // raw-mode stdin reader, which can hang on macOS/Bun after the in-process
    // handoff (paste/keys never arrive, Ctrl-C dead). /dev/tty always works.
    const choice = pickToTTY({
      message: "Continue with local installation?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      defaultValue: "yes",
    });
    if (choice !== "yes") {
      logInfo("Installation cancelled.");
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
