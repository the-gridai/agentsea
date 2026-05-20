import type { AgentModule } from "../agent-module.js";
import { resolveLegacyAgentConfig } from "./legacy-config.js";

export function buildLegacyAgentModule(slug: string): AgentModule {
  return {
    slug,
    createConfig: (runner) => resolveLegacyAgentConfig(runner, slug),
  };
}
