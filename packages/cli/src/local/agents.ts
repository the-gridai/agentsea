// local/agents.ts — Local machine agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFile, runLocal, startService, uploadFile } from "./local.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer: runLocal,
  uploadFile: async (l: string, r: string) => uploadFile(l, r),
  downloadFile: async (r: string, l: string) => downloadFile(r, l),
  startService,
});
