import type { SpawnRecord } from "../history.js";
import type { AgentConfig } from "./agents.js";
import type { CloudOrchestrator } from "./orchestrate.js";

export interface CloudProviderCapabilities {
  /**
   * Some providers (DigitalOcean) run a guided readiness gate during orchestration,
   * so command preflight should not duplicate interactive credential warnings.
   */
  skipInteractivePreflightCredentialCheck?: boolean;
}

export interface CloudProvider {
  slug: string;
  label: string;
  /**
   * Relative path from `packages/cli/src/` to the provider's main entrypoint.
   * Used by local checkout execution paths.
   */
  localMainEntrypoint: string;
  capabilities?: CloudProviderCapabilities;
  createOrchestrator?: (agentName: string, agent: AgentConfig) => CloudOrchestrator;
  buildResumeOrchestrator?: (record: SpawnRecord) => Promise<CloudOrchestrator | null>;
}
