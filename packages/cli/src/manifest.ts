/**
 * Thin shim — `@agentsea/sdk` owns manifest types + disk/network loading.
 */

export type {
  AgentDef,
  CloudDef,
  Manifest,
  McpServerConfig,
  SkillAgentConfig,
  SkillDef,
} from "@agentsea/sdk";

export {
  RAW_BASE,
  REPO,
  AGENTSEA_CDN,
  VERSION_URL,
  _resetCacheForTesting,
  agentKeys,
  cloudKeys,
  countImplemented,
  getCacheAge,
  isStaleCache,
  loadManifest,
  matrixStatus,
  stripDangerousKeys,
} from "@agentsea/sdk/node";
