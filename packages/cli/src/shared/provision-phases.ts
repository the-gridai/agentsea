/** Ordered provisioning phases — single source of truth for resume / telemetry. */

export const PROVISION_PHASES = [
  "pending",
  "cloud_authenticated",
  "vm_creating",
  "vm_created",
  "vm_waiting",
  "vm_ready",
  "credentials_ready",
  "agent_installing",
  "agent_installed",
  "env_injecting",
  "env_injected",
  "post_install",
  "agent_configured",
  "complete",
] as const;

export type ProvisionPhase = (typeof PROVISION_PHASES)[number];

export type ProvisionStatus = "pending" | "in_progress" | "complete" | "failed" | "degraded";

/** Legacy records have no phase — treat as fully provisioned for resume heuristics. */
export function provisionPhaseIndex(phase: ProvisionPhase | undefined): number {
  if (phase === undefined) {
    return PROVISION_PHASES.length;
  }
  const i = PROVISION_PHASES.indexOf(phase);
  return i >= 0 ? i : 0;
}

export function isProvisioningIncomplete(record: {
  connection?: { deleted?: boolean } | null;
  provision_phase?: ProvisionPhase;
  provision_status?: ProvisionStatus;
}): boolean {
  if (!record.connection || record.connection.deleted) {
    return false;
  }
  if (record.provision_status === "failed" || record.provision_status === "pending") {
    return true;
  }
  if (record.provision_status === "in_progress") {
    return true;
  }
  if (record.provision_phase && record.provision_phase !== "complete") {
    return true;
  }
  return false;
}
