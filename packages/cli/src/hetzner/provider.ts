import type { SpawnRecord, VMConnection } from "../history.js";
import type { CloudProvider } from "../shared/cloud-provider.js";
import type { CloudOrchestrator } from "../shared/orchestrate.js";
import {
  downloadFile,
  ensureHcloudToken,
  interactiveSession,
  runServer,
  uploadFile,
  waitForCloudInit,
} from "./hetzner.js";

export async function buildHetznerResumeOrchestrator(record: SpawnRecord): Promise<CloudOrchestrator | null> {
  const conn = record.connection;
  if (!conn?.ip || conn.deleted) {
    return null;
  }

  await ensureHcloudToken();
  const ip = conn.ip;
  const vmConn: VMConnection = {
    ...conn,
  };

  return {
    cloudName: "hetzner",
    cloudLabel: "Hetzner Cloud",
    skipAgentInstall: false,
    runner: {
      runServer: (cmd, timeoutSecs) => runServer(cmd, timeoutSecs, ip),
      uploadFile: (localPath, remotePath) => uploadFile(localPath, remotePath, ip),
      downloadFile: (remotePath, localPath) => downloadFile(remotePath, localPath, ip),
    },
    async authenticate() {
      await ensureHcloudToken();
    },
    async promptSize() {},
    async createServer() {
      return vmConn;
    },
    getServerName: async () => conn.server_name ?? "grid-spawn-resume",
    async waitForReady() {
      await waitForCloudInit(ip);
    },
    interactiveSession: (cmd: string) => interactiveSession(cmd, ip),
    getConnectionInfo: () => ({
      host: ip,
      user: conn.user,
    }),
  };
}

export const hetznerProvider: CloudProvider = {
  slug: "hetzner",
  label: "Hetzner Cloud",
  localMainEntrypoint: "hetzner/main.ts",
  buildResumeOrchestrator: buildHetznerResumeOrchestrator,
};
