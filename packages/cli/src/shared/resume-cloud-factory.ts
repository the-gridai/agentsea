// Build a CloudOrchestrator wired to an existing VM (for resume / continue provisioning).

import type { AgentseaRecord } from "../history.js";
import type { CloudOrchestrator } from "./orchestrate.js";
import { getCloudProvider } from "./cloud-provider-registry.js";

/** SSH-capable clouds where runServer/upload/download accept an optional IP. */
export async function buildCloudOrchestratorForResume(record: AgentseaRecord): Promise<CloudOrchestrator | null> {
  const conn = record.connection;
  if (!conn?.ip || conn.deleted) {
    return null;
  }

  const cloudSlug = conn.cloud ?? record.cloud;
  const provider = getCloudProvider(cloudSlug);
  if (!provider?.buildResumeOrchestrator) {
    return null;
  }
  return provider.buildResumeOrchestrator(record);
}
