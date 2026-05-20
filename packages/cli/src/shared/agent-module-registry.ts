import type { AgentConfig } from "./agents.js";
import type { CloudRunner } from "./agent-setup.js";
import type { AgentModule } from "./agent-module.js";
import { logError } from "./ui.js";
import { AGENT_MODULES } from "./agent-modules/index.js";

function buildModuleMap(modules: AgentModule[]): Record<string, AgentModule> {
  const bySlug: Record<string, AgentModule> = {};
  for (const module of modules) {
    if (bySlug[module.slug]) {
      throw new Error(`Duplicate agent module slug: ${module.slug}`);
    }
    bySlug[module.slug] = module;
  }
  return bySlug;
}

const modulesBySlug = buildModuleMap(AGENT_MODULES);

export function listAgentModuleSlugs(): string[] {
  return Object.keys(modulesBySlug);
}

export function resolveAgentModule(name: string): AgentModule {
  const module = modulesBySlug[name.toLowerCase()];
  if (!module) {
    logError(`Unknown agent module: ${name}`);
    logError(`Available agent modules: ${listAgentModuleSlugs().join(", ")}`);
    throw new Error(`Unknown agent: ${name}`);
  }
  return module;
}

export function resolveAgentConfigFromModule(name: string, runner: CloudRunner): AgentConfig {
  return resolveAgentModule(name).createConfig(runner);
}

/**
 * Temporary compatibility shim for existing cloud adapters that still expect
 * `createCloudAgents()` style return values.
 */
export function createCloudAgentsFromModules(runner: CloudRunner): {
  agents: Record<string, AgentConfig>;
  resolveAgent: (name: string) => AgentConfig;
} {
  const agents: Record<string, AgentConfig> = {};
  for (const module of AGENT_MODULES) {
    agents[module.slug] = module.createConfig(runner);
  }
  return {
    agents,
    resolveAgent: (name: string) => {
      const key = name.toLowerCase();
      const agent = agents[key];
      if (!agent) {
        logError(`Unknown agent: ${name}`);
        logError(`Available agents: ${Object.keys(agents).join(", ")}`);
        throw new Error(`Unknown agent: ${name}`);
      }
      return agent;
    },
  };
}
