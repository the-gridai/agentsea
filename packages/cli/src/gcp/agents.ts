// gcp/agents.ts — GCP Compute Engine agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFile, runServer, uploadFile } from "./gcp.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer,
  uploadFile,
  downloadFile,
});
