// aws/agents.ts — AWS Lightsail agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFile, runServer, uploadFile } from "./aws.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer,
  uploadFile,
  downloadFile,
});
