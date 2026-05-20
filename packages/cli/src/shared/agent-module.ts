import type { AgentConfig } from "./agents.js";
import type { CloudRunner } from "./agent-setup.js";

/**
 * Agent module contract used by the module registry.
 * Modules can compose around legacy createCloudAgents() while we migrate.
 */
export interface AgentModule {
  slug: string;
  createConfig: (runner: CloudRunner) => AgentConfig;
}
