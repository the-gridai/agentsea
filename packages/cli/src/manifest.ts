/**
 * Thin shim — `@grid-spawn/sdk` owns manifest types + disk/network loading.
 */

export type {
  AgentDef,
  CloudDef,
  Manifest,
  McpServerConfig,
  SkillAgentConfig,
  SkillDef,
} from "@grid-spawn/sdk";

export {
  RAW_BASE,
  REPO,
  SPAWN_CDN,
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
} from "@grid-spawn/sdk/node";
