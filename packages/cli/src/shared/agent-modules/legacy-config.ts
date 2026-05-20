import type { CloudRunner } from "../agent-setup.js";
import type { AgentConfig } from "../agents.js";
import { createCloudAgents } from "../agent-setup.js";

const legacyAgentCache = new WeakMap<CloudRunner, ReturnType<typeof createCloudAgents>>();

function getLegacyAgentFactory(runner: CloudRunner): ReturnType<typeof createCloudAgents> {
  const cached = legacyAgentCache.get(runner);
  if (cached) {
    return cached;
  }
  const factory = createCloudAgents(runner);
  legacyAgentCache.set(runner, factory);
  return factory;
}

export function resolveLegacyAgentConfig(runner: CloudRunner, slug: string): AgentConfig {
  return getLegacyAgentFactory(runner).resolveAgent(slug);
}
