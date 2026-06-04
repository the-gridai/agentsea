// shared/lifecycle-telemetry.ts — Track agentsea-level lifecycle events:
// login count and total lifetime on delete.
//
// Why it's here and not in telemetry.ts:
//   telemetry.ts is a low-level primitive (PostHog batching, scrubbing,
//   session context). It deliberately has no knowledge of AgentseaRecord,
//   history, or any product concepts. Lifecycle helpers need both, so
//   they live one layer up.
//
// Event shapes (all respect AGENTSEA_TELEMETRY=0 opt-out via captureEvent):
//
//   agentsea_connected  { agentsea_id, agent, cloud, connect_count, date }
//   agentsea_deleted    { agentsea_id, agent, cloud, lifetime_hours, connect_count, date }
//
// Persistence model:
//   connect_count + last_connected_at are stored inside
//   AgentseaRecord.connection.metadata as strings (the existing schema is
//   Record<string, string>, so we serialize numbers as strings and parse
//   on read). saveMetadata merges — no risk of clobbering other keys.

import type { AgentseaRecord } from "../history.js";

import { saveMetadata } from "../history.js";
import { captureEvent } from "./telemetry.js";

/** Read the stored connect count for a agentsea, defaulting to 0. */
function readConnectCount(record: AgentseaRecord): number {
  const raw = record.connection?.metadata?.connect_count;
  if (!raw) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Compute lifetime hours between agentsea creation and now (or delete time). */
function computeLifetimeHours(record: AgentseaRecord, endIso?: string): number {
  const start = Date.parse(record.timestamp);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * Record a user reconnecting to an existing agentsea.
 *
 * Increments the stored connect_count, updates last_connected_at, and fires
 * a agentsea_connected telemetry event. Returns the new count so callers can
 * also display it if they want.
 */
export function trackAgentseaConnected(record: AgentseaRecord): number {
  if (!record.id || !record.connection) {
    return 0;
  }
  const newCount = readConnectCount(record) + 1;
  const nowIso = new Date().toISOString();

  saveMetadata(
    {
      connect_count: String(newCount),
      last_connected_at: nowIso,
    },
    record.id,
  );

  captureEvent("agentsea_connected", {
    agentsea_id: record.id,
    agent: record.agent,
    cloud: record.cloud,
    connect_count: newCount,
    date: nowIso,
  });

  return newCount;
}

/**
 * Record a user deleting a agentsea.
 *
 * Emits a agentsea_deleted event with the total lifetime (hours) and final
 * login count, so we can build a "typical agentsea lives N hours, N logins"
 * picture in aggregate. Call AFTER the cloud destroy succeeds — failed
 * deletes should not fire this event.
 */
export function trackAgentseaDeleted(record: AgentseaRecord): void {
  if (!record.id) {
    return;
  }
  const nowIso = new Date().toISOString();

  captureEvent("agentsea_deleted", {
    agentsea_id: record.id,
    agent: record.agent,
    cloud: record.cloud,
    lifetime_hours: computeLifetimeHours(record, nowIso),
    connect_count: readConnectCount(record),
    date: nowIso,
  });
}
