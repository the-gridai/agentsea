import type { SpawnRecord, VMConnection } from "../history.js";
import type { AgentConfig } from "../shared/agents.js";
import type { CloudProvider } from "../shared/cloud-provider.js";
import type { CloudOrchestrator } from "../shared/orchestrate.js";
import { digitalOceanGridSpawnImageSlug } from "../shared/vendor-routing.js";
import { logInfo } from "../shared/ui.js";
import {
  AGENT_MIN_SIZE,
  createServer as createDroplet,
  downloadFile,
  ensureDoToken,
  getConnectionInfo,
  getServerName,
  interactiveSession,
  promptDoRegion,
  promptDropletSize,
  promptSpawnName,
  runServer,
  slugRamGb,
  uploadFile,
  waitForCloudInit,
  waitForSshOnly,
} from "./digitalocean.js";
import { runDigitalOceanReadinessGate } from "./readiness.js";

/** DigitalOcean Marketplace snapshot slugs for Grid-published images (portal naming; see todo.md). */
const MARKETPLACE_IMAGES: Record<string, string> = {
  claude: digitalOceanGridSpawnImageSlug("claude"),
  codex: digitalOceanGridSpawnImageSlug("codex"),
  openclaw: digitalOceanGridSpawnImageSlug("openclaw"),
  opencode: digitalOceanGridSpawnImageSlug("opencode"),
  kilocode: digitalOceanGridSpawnImageSlug("kilocode"),
  hermes: digitalOceanGridSpawnImageSlug("hermes"),
  junie: digitalOceanGridSpawnImageSlug("junie"),
};

export function createDigitalOceanOrchestrator(agentName: string, agent: AgentConfig): CloudOrchestrator {
  let dropletSize = "";
  let region = "";
  let marketplaceImage: string | undefined;

  const cloud: CloudOrchestrator = {
    cloudName: "digitalocean",
    cloudLabel: "DigitalOcean",
    capabilities: {
      skipParallelAccountReadyCheck: true,
    },
    skipAgentInstall: false,
    runner: {
      runServer,
      uploadFile,
      downloadFile,
    },
    async authenticate() {
      await promptSpawnName();
    },
    async ensureReadyBeforeSizing() {
      await runDigitalOceanReadinessGate({
        agentName,
      });
    },
    async promptSize() {
      dropletSize = await promptDropletSize();
      // Enforce minimum size for agents that need more RAM (e.g. openclaw-plugins OOMs on 2GB)
      const minSize = AGENT_MIN_SIZE[agentName];
      if (minSize && (!dropletSize || slugRamGb(dropletSize) < slugRamGb(minSize))) {
        dropletSize = minSize;
        logInfo(`Using ${minSize} (minimum for ${agentName})`);
      }
      region = await promptDoRegion();
    },
    async createServer(name: string) {
      // Use pre-built marketplace image when --beta images is active
      const betaFeatures = (process.env.SPAWN_BETA ?? "").split(",");
      if (betaFeatures.includes("images")) {
        const slug = MARKETPLACE_IMAGES[agentName];
        if (slug) {
          marketplaceImage = slug;
          cloud.skipAgentInstall = true;
          logInfo(`Using marketplace image: ${slug}`);
        } else {
          logInfo(`No marketplace image for ${agentName}, using fresh install`);
        }
      }
      return await createDroplet(name, agent.cloudInitTier, dropletSize, region, marketplaceImage);
    },
    getServerName,
    async waitForReady() {
      if (marketplaceImage || cloud.skipCloudInit) {
        await waitForSshOnly();
      } else {
        await waitForCloudInit();
      }
    },
    interactiveSession,
    getConnectionInfo,
  };

  return cloud;
}

export async function buildDigitalOceanResumeOrchestrator(record: SpawnRecord): Promise<CloudOrchestrator | null> {
  const conn = record.connection;
  if (!conn?.ip || conn.deleted) {
    return null;
  }
  await ensureDoToken();
  const ip = conn.ip;
  const vmConn: VMConnection = {
    ...conn,
  };

  return {
    cloudName: "digitalocean",
    cloudLabel: "DigitalOcean",
    capabilities: {
      skipParallelAccountReadyCheck: true,
    },
    skipAgentInstall: false,
    runner: {
      runServer: (cmd, timeoutSecs) => runServer(cmd, timeoutSecs, ip),
      uploadFile: (localPath, remotePath) => uploadFile(localPath, remotePath, ip),
      downloadFile: (remotePath, localPath) => downloadFile(remotePath, localPath, ip),
    },
    async authenticate() {
      await ensureDoToken();
    },
    async promptSize() {},
    async createServer() {
      return vmConn;
    },
    getServerName: async () => conn.server_name ?? "grid-spawn-resume",
    async waitForReady() {
      await waitForSshOnly(ip);
    },
    interactiveSession: (cmd: string) => interactiveSession(cmd, ip),
    getConnectionInfo: () => ({
      host: ip,
      user: conn.user,
    }),
  };
}

export const digitalOceanProvider: CloudProvider = {
  slug: "digitalocean",
  label: "DigitalOcean",
  localMainEntrypoint: "digitalocean/main.ts",
  capabilities: {
    skipInteractivePreflightCredentialCheck: true,
  },
  createOrchestrator: createDigitalOceanOrchestrator,
  buildResumeOrchestrator: buildDigitalOceanResumeOrchestrator,
};
