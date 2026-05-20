// hetzner/agents.ts — Hetzner Cloud agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFile, runServer, uploadFile } from "./hetzner.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer,
  uploadFile,
  downloadFile,
});
