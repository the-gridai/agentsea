// daytona/agents.ts — Daytona agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFile, runServer, uploadFile } from "./daytona.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer,
  uploadFile,
  downloadFile,
});
