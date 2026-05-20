// sprite/agents.ts — Sprite agent configs (thin wrapper over shared)

import { createCloudAgentsFromModules } from "../shared/agent-module-registry.js";
import { downloadFileSprite, runSprite, uploadFileSprite } from "./sprite.js";

export const { agents, resolveAgent } = createCloudAgentsFromModules({
  runServer: runSprite,
  uploadFile: uploadFileSprite,
  downloadFile: downloadFileSprite,
});
