import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getErrorMessage } from "@agentsea/sdk";
import * as v from "valibot";
import { getHistoryPath, getProvisionRunsDir, getAgentseaDir } from "./shared/paths.js";
import {
  isProvisioningIncomplete,
  PROVISION_PHASES,
  type ProvisionPhase,
  type ProvisionStatus,
} from "./shared/provision-phases.js";
import { isFileError, tryCatch, tryCatchIf } from "./shared/result.js";

export type { ProvisionPhase, ProvisionStatus };
export { isProvisioningIncomplete };
import { logDebug, logWarn } from "./shared/ui.js";

export interface VMConnection {
  ip: string;
  user: string;
  server_id?: string;
  server_name?: string;
  cloud?: string;
  deleted?: boolean;
  deleted_at?: string;
  launch_cmd?: string;
  metadata?: Record<string, string>;
}

export interface AgentseaRecord {
  id: string;
  agent: string;
  cloud: string;
  timestamp: string;
  name?: string;
  prompt?: string;
  connection?: VMConnection;
  parent_id?: string;
  depth?: number;
  provision_phase?: ProvisionPhase;
  provision_status?: ProvisionStatus;
  provision_error?: string;
  provision_updated_at?: string;
  post_install_soft_failures?: string[];
}

/** Simplified cloud instance info returned by each provider's listServers(). */
export interface CloudInstance {
  id: string;
  name: string;
  ip: string;
  status: string;
}

// ── Schema versioning ──────────────────────────────────────────────────────

export const HISTORY_SCHEMA_VERSION = 1;

const VMConnectionSchema = v.object({
  ip: v.string(),
  user: v.string(),
  server_id: v.optional(v.string()),
  server_name: v.optional(v.string()),
  cloud: v.optional(v.string()),
  deleted: v.optional(v.boolean()),
  deleted_at: v.optional(v.string()),
  launch_cmd: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.string())),
});

const ProvisionPhaseSchema = v.optional(v.picklist(PROVISION_PHASES));
const ProvisionStatusSchema = v.optional(
  v.picklist([
    "pending",
    "in_progress",
    "complete",
    "failed",
    "degraded",
  ]),
);

export const AgentseaRecordSchema = v.object({
  id: v.optional(v.string()), // optional for backwards compat with pre-migration records on disk
  agent: v.string(),
  cloud: v.string(),
  timestamp: v.string(),
  name: v.optional(v.string()),
  prompt: v.optional(v.string()),
  connection: v.optional(VMConnectionSchema),
  parent_id: v.optional(v.string()),
  depth: v.optional(v.number()),
  provision_phase: ProvisionPhaseSchema,
  provision_status: ProvisionStatusSchema,
  provision_error: v.optional(v.string()),
  provision_updated_at: v.optional(v.string()),
  post_install_soft_failures: v.optional(v.array(v.string())),
});

const CHECKPOINT_FILE_VERSION = 1;
const CheckpointFileSchema = v.object({
  version: v.literal(1),
  record: AgentseaRecordSchema,
});

/** v1 history file format: { version: 1, records: AgentseaRecord[] } */
const HistoryFileV1Schema = v.object({
  version: v.literal(1),
  records: v.array(AgentseaRecordSchema),
});

/** Loose v1 schema — validates shape but not individual records */
const HistoryFileV1LooseSchema = v.object({
  version: v.literal(1),
  records: v.array(v.unknown()),
});

/** Generate a unique agentsea ID. */
export function generateAgentseaId(): string {
  return randomUUID();
}

// ── File locking ─────────────────────────────────────────────────────────
//
// Uses mkdir-based advisory lock: mkdir is atomic on all POSIX systems and
// Windows. The lock directory doubles as a signal — if it exists, another
// process holds the lock. Stale locks (older than 30s) are force-removed
// to prevent deadlocks from crashed processes.

const LOCK_TIMEOUT_MS = 5000; // Max time to wait for lock
const LOCK_STALE_MS = 30_000; // Force-remove locks older than this
const LOCK_POLL_MS = 50; // Poll interval when waiting

function getLockPath(): string {
  return `${getHistoryPath()}.lock`;
}

function acquireLock(): boolean {
  const lockPath = getLockPath();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const mkdirResult = tryCatch(() => {
      mkdirSync(lockPath);
    });
    if (mkdirResult.ok) {
      // Write PID + timestamp for stale detection
      const pidWriteResult = tryCatch(() => writeFileSync(join(lockPath, "pid"), `${process.pid}\n${Date.now()}`));
      if (!pidWriteResult.ok) {
        // PID write failed — clean up and retry so we don't leave an undetectable lock
        tryCatch(() => rmdirSync(lockPath));
        continue;
      }
      return true;
    }

    // Lock exists — check if stale
    const staleResult = tryCatch(() => {
      const pidFile = join(lockPath, "pid");
      if (existsSync(pidFile)) {
        const content = readFileSync(pidFile, "utf-8");
        const lines = content.split("\n");
        const lockTime = Number(lines[1]);
        if (lockTime && Date.now() - lockTime > LOCK_STALE_MS) {
          // Stale lock — force remove
          tryCatch(() => unlinkSync(join(lockPath, "pid")));
          tryCatch(() => rmdirSync(lockPath));
          return true; // Retry on next iteration
        }
      } else {
        // Lock dir exists but no PID file — broken lock, force remove
        tryCatch(() => rmdirSync(lockPath));
        return true;
      }
      return false;
    });

    if (staleResult.ok && staleResult.data) {
      continue; // Stale lock removed, retry immediately
    }

    // Wait and retry
    Bun.sleepSync(LOCK_POLL_MS);
  }

  logWarn("Could not acquire history lock — proceeding without lock");
  return false;
}

function releaseLock(): void {
  const lockPath = getLockPath();
  tryCatch(() => unlinkSync(join(lockPath, "pid")));
  tryCatch(() => rmdirSync(lockPath));
}

/** Run a function while holding the history file lock.
 *  Ensures only one process modifies history.json at a time. */
function withHistoryLock<T>(fn: () => T): T {
  const locked = acquireLock();
  const result = tryCatch(fn);
  if (locked) {
    releaseLock();
  }
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

/** Atomically write a JSON file: write to a process-unique .tmp, then rename into place.
 * The unique suffix prevents races when multiple concurrent agentsea processes write history. */
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(tmpPath, filePath);
}

/** Sidecar checkpoint so a crash after VM create can still be recovered (`agentsea resume --recover`). */
export function writeProvisionCheckpoint(record: AgentseaRecord): void {
  if (!record.id) {
    return;
  }
  const dir = getProvisionRunsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, {
      recursive: true,
      mode: 0o700,
    });
  }
  const filePath = join(dir, `${record.id}.json`);
  atomicWriteJson(filePath, {
    version: CHECKPOINT_FILE_VERSION,
    record,
  });
}

export function readProvisionCheckpoint(agentseaId: string): AgentseaRecord | null {
  const filePath = join(getProvisionRunsDir(), `${agentseaId}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  const parsedFile = tryCatch((): unknown => JSON.parse(readFileSync(filePath, "utf-8")));
  if (!parsedFile.ok) {
    return null;
  }
  const parsed = v.safeParse(CheckpointFileSchema, parsedFile.data);
  if (!parsed.success) {
    return null;
  }
  const r = parsed.output.record;
  const rec: AgentseaRecord = {
    ...r,
    id: r.id ?? agentseaId,
    provision_phase: r.provision_phase as ProvisionPhase | undefined,
    provision_status: r.provision_status as ProvisionStatus | undefined,
  };
  return rec;
}

export function deleteProvisionCheckpoint(agentseaId: string): void {
  tryCatch(() => unlinkSync(join(getProvisionRunsDir(), `${agentseaId}.json`)));
}

export function listProvisionCheckpoints(): AgentseaRecord[] {
  const dir = getProvisionRunsDir();
  if (!existsSync(dir)) {
    return [];
  }
  const out: AgentseaRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) {
      continue;
    }
    const id = f.replace(/\.json$/u, "");
    const rec = readProvisionCheckpoint(id);
    if (rec) {
      out.push(rec);
    }
  }
  return out;
}

/** Write history records to disk in v1 format: { version: 1, records: [...] } */
function writeHistory(records: AgentseaRecord[]): void {
  atomicWriteJson(getHistoryPath(), {
    version: HISTORY_SCHEMA_VERSION,
    records,
  });
}

/** Save launch command to a history record's connection.
 *  Requires agentseaId to target the correct record. */
export function saveLaunchCmd(launchCmd: string, agentseaId?: string): void {
  const result = tryCatchIf(isFileError, () => {
    withHistoryLock(() => {
      const history = loadHistory();
      let found = false;

      if (agentseaId) {
        const idx = history.findIndex((r) => r.id === agentseaId);
        if (idx >= 0 && history[idx].connection) {
          history[idx].connection.launch_cmd = launchCmd;
          found = true;
        }
      } else {
        // Fallback: most recent record with a connection
        for (let i = history.length - 1; i >= 0; i--) {
          const conn = history[i].connection;
          if (conn) {
            conn.launch_cmd = launchCmd;
            found = true;
            break;
          }
        }
      }

      if (found) {
        writeHistory(history);
      }
    });
  });
  if (!result.ok) {
    logWarn("Could not save launch command");
    logDebug(getErrorMessage(result.error));
  }
}

/** Merge metadata key-value pairs into a history record's connection.
 *  Requires agentseaId to target the correct record. */
export function saveMetadata(entries: Record<string, string>, agentseaId?: string): void {
  const result = tryCatchIf(isFileError, () => {
    withHistoryLock(() => {
      const history = loadHistory();
      let found = false;

      if (agentseaId) {
        const idx = history.findIndex((r) => r.id === agentseaId);
        if (idx >= 0 && history[idx].connection) {
          const conn = history[idx].connection;
          conn.metadata = {
            ...conn.metadata,
            ...entries,
          };
          found = true;
        }
      } else {
        for (let i = history.length - 1; i >= 0; i--) {
          const conn = history[i].connection;
          if (conn) {
            conn.metadata = {
              ...conn.metadata,
              ...entries,
            };
            found = true;
            break;
          }
        }
      }

      if (found) {
        writeHistory(history);
      }
    });
  });
  if (!result.ok) {
    logWarn("Could not save metadata");
    logDebug(getErrorMessage(result.error));
  }
}

/** Back up a corrupted file before discarding it. Non-fatal (best-effort). */
function backupCorruptedFile(filePath: string): void {
  const result = tryCatchIf(isFileError, () => {
    copyFileSync(filePath, `${filePath}.corrupt.${Date.now()}`);
    console.error(`Warning: ${filePath} was corrupted. A backup has been saved with .corrupt suffix.`);
  });
  if (!result.ok) {
    logDebug(`Could not back up corrupted file: ${getErrorMessage(result.error)}`);
  }
}

/** Try to parse valid records from a single archive file.
 *  Uses tryCatch (catch-all) because corrupted JSON is expected — SyntaxError is not a file error. */
function parseArchiveFile(dir: string, file: string): AgentseaRecord[] | null {
  const result = tryCatch(() => {
    const text = readFileSync(join(dir, file), "utf-8");
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.filter((el) => v.safeParse(AgentseaRecordSchema, el).success);
    }
    return [];
  });
  if (!result.ok) {
    return null;
  }
  return result.data.length > 0 ? result.data : null;
}

/** Attempt to recover records from archive files (history-*.json).
 *  Uses tryCatch (catch-all) because archive recovery is best-effort — any failure returns [].
 *  Only checks the 30 most recent archives to avoid startup slowdowns. */
function recoverFromArchives(): AgentseaRecord[] {
  const result = tryCatch(() => {
    const dir = getAgentseaDir();
    const files = readdirSync(dir)
      .filter((f) => /^history-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, 30);
    for (const file of files) {
      const records = parseArchiveFile(dir, file);
      if (records) {
        console.error(`Recovered ${records.length} record(s) from archive ${file}.`);
        return records;
      }
    }
    return [];
  });
  return result.ok ? result.data : [];
}

/** Backfill missing `id` field on parsed records (pre-migration records lack it). */
function backfillRecordIds(records: v.InferOutput<typeof AgentseaRecordSchema>[]): AgentseaRecord[] {
  return records.map((r) => ({
    ...r,
    id: r.id ?? generateAgentseaId(),
    provision_phase: r.provision_phase as ProvisionPhase | undefined,
    provision_status: r.provision_status as ProvisionStatus | undefined,
  }));
}

/** Parse raw JSON into AgentseaRecord[], handling all format versions. */
function parseHistoryData(raw: unknown): AgentseaRecord[] | null {
  // v1 format: { version: 1, records: [...] } — strict check
  const v1 = v.safeParse(HistoryFileV1Schema, raw);
  if (v1.success) {
    return backfillRecordIds(v1.output.records);
  }

  // Loose v1: version=1 but some individual records are malformed
  const v1Loose = v.safeParse(HistoryFileV1LooseSchema, raw);
  if (v1Loose.success) {
    const allRecords = v1Loose.output.records;
    const valid: v.InferOutput<typeof AgentseaRecordSchema>[] = [];
    for (const el of allRecords) {
      const result = v.safeParse(AgentseaRecordSchema, el);
      if (result.success) {
        valid.push(result.output);
      }
    }
    const dropped = allRecords.length - valid.length;
    if (dropped > 0) {
      console.error(`Warning: Dropped ${dropped} malformed record(s) from history.`);
    }
    return backfillRecordIds(valid);
  }

  // v0 format: bare array (pre-versioning; migrated to v1 on next write)
  if (Array.isArray(raw)) {
    const valid: v.InferOutput<typeof AgentseaRecordSchema>[] = [];
    for (const el of raw) {
      const result = v.safeParse(AgentseaRecordSchema, el);
      if (result.success) {
        valid.push(result.output);
      }
    }
    return backfillRecordIds(valid);
  }

  // Unrecognized format
  return null;
}

export function loadHistory(): AgentseaRecord[] {
  const path = getHistoryPath();
  if (!existsSync(path)) {
    return [];
  }
  const readResult = tryCatchIf(isFileError, () => readFileSync(path, "utf-8"));
  if (!readResult.ok) {
    logWarn("Could not read agentsea history");
    logDebug(getErrorMessage(readResult.error));
    return [];
  }
  const text = readResult.data;
  if (!text.trim()) {
    return [];
  }

  const parseResult = tryCatch((): unknown => JSON.parse(text));
  if (!parseResult.ok) {
    // JSON parse failed — file is corrupted
    backupCorruptedFile(path);
    return recoverFromArchives();
  }

  const records = parseHistoryData(parseResult.data);
  if (records !== null) {
    // Backfill IDs on legacy records that don't have one
    for (const r of records) {
      if (!r.id) {
        r.id = generateAgentseaId();
      }
    }
    return records;
  }

  // Unrecognized format
  backupCorruptedFile(path);
  return recoverFromArchives();
}

export function saveAgentseaRecord(record: AgentseaRecord): void {
  const dir = getAgentseaDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, {
      recursive: true,
      mode: 0o700,
    });
  }
  // Every record must have an id
  if (!record.id) {
    record.id = generateAgentseaId();
  }

  withHistoryLock(() => {
    const history = loadHistory();
    history.push(record);
    writeHistory(history);
  });
}

/** Insert or replace by `id` (provisioning updates the same agentsea row). Syncs crash-safe checkpoint. */
export function upsertAgentseaRecord(record: AgentseaRecord): void {
  const dir = getAgentseaDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, {
      recursive: true,
      mode: 0o700,
    });
  }
  if (!record.id) {
    record.id = generateAgentseaId();
  }

  let merged: AgentseaRecord;
  withHistoryLock(() => {
    const history = loadHistory();
    const idx = history.findIndex((r) => r.id === record.id);
    merged = idx >= 0 ? { ...history[idx]!, ...record } : record;
    if (idx >= 0) {
      history[idx] = merged;
    } else {
      history.push(merged);
    }
    writeHistory(history);
  });
  writeProvisionCheckpoint(merged!);
}

/** Patch fields on a agentsea by id and refresh checkpoint (caller should set provision_* fields as needed). */
export function patchAgentseaRecord(agentseaId: string, patch: Partial<AgentseaRecord>): void {
  withHistoryLock(() => {
    const history = loadHistory();
    const idx = history.findIndex((r) => r.id === agentseaId);
    if (idx < 0) {
      return;
    }
    const merged: AgentseaRecord = {
      ...history[idx]!,
      ...patch,
      provision_updated_at: patch.provision_updated_at ?? new Date().toISOString(),
    };
    history[idx] = merged;
    writeHistory(history);
    writeProvisionCheckpoint(merged);
  });
}

export function clearHistory(): number {
  const path = getHistoryPath();
  if (!existsSync(path)) {
    return 0;
  }
  const records = loadHistory();
  const count = records.length;
  if (count > 0) {
    unlinkSync(path);
  }
  return count;
}

/** Find a record's index by id, falling back to timestamp+agent+cloud for old records. */
function findRecordIndex(history: AgentseaRecord[], record: AgentseaRecord): number {
  if (record.id) {
    const idx = history.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      return idx;
    }
  }
  // Fallback for records without id (pre-migration)
  return history.findIndex(
    (r) => r.timestamp === record.timestamp && r.agent === record.agent && r.cloud === record.cloud,
  );
}

/** Remove a record from history entirely (soft delete — no cloud API call). */
export function removeRecord(record: AgentseaRecord): boolean {
  return withHistoryLock(() => {
    const history = loadHistory();
    const index = findRecordIndex(history, record);
    if (index < 0) {
      return false;
    }
    history.splice(index, 1);
    writeHistory(history);
    return true;
  });
}

export function markRecordDeleted(record: AgentseaRecord): boolean {
  return withHistoryLock(() => {
    const history = loadHistory();
    const index = findRecordIndex(history, record);
    if (index < 0) {
      return false;
    }
    const found = history[index];
    if (!found.connection) {
      return false;
    }
    found.connection.deleted = true;
    found.connection.deleted_at = new Date().toISOString();
    writeHistory(history);
    return true;
  });
}

/** Update the IP address on a history record's connection. Returns true if the record was found and updated. */
export function updateRecordIp(record: AgentseaRecord, newIp: string): boolean {
  return withHistoryLock(() => {
    const history = loadHistory();
    const index = findRecordIndex(history, record);
    if (index < 0) {
      return false;
    }
    const found = history[index];
    if (!found.connection) {
      return false;
    }
    found.connection.ip = newIp;
    writeHistory(history);
    return true;
  });
}

/** Update connection fields (ip, server_id, server_name) on a history record. Used for remapping to a different instance. */
export function updateRecordConnection(
  record: AgentseaRecord,
  updates: {
    ip?: string;
    server_id?: string;
    server_name?: string;
  },
): boolean {
  return withHistoryLock(() => {
    const history = loadHistory();
    const index = findRecordIndex(history, record);
    if (index < 0) {
      return false;
    }
    const found = history[index];
    if (!found.connection) {
      return false;
    }
    if (updates.ip !== undefined) {
      found.connection.ip = updates.ip;
    }
    if (updates.server_id !== undefined) {
      found.connection.server_id = updates.server_id;
    }
    if (updates.server_name !== undefined) {
      found.connection.server_name = updates.server_name;
    }
    writeHistory(history);
    return true;
  });
}

export function getActiveServers(): AgentseaRecord[] {
  const records = loadHistory();
  return records.filter((r) => r.connection?.cloud && r.connection.cloud !== "local" && !r.connection.deleted);
}

/** Merge child agentsea records into local history.
 *  Sets parent_id on each child record and deduplicates by agentsea ID. */
export function mergeChildHistory(parentAgentseaId: string, childRecords: AgentseaRecord[]): void {
  if (childRecords.length === 0) {
    return;
  }

  withHistoryLock(() => {
    const history = loadHistory();
    const existingIds = new Set(history.map((r) => r.id));

    for (const child of childRecords) {
      if (!child.id) {
        child.id = generateAgentseaId();
      }
      // Skip duplicates
      if (existingIds.has(child.id)) {
        continue;
      }
      // Ensure parent_id is set
      if (!child.parent_id) {
        child.parent_id = parentAgentseaId;
      }
      history.push(child);
      existingIds.add(child.id);
    }

    writeHistory(history);
  });
}

/** Export history records as JSON string (for `agentsea history export`). */
export function exportHistory(): string {
  const records = loadHistory();
  return JSON.stringify(records, null, 2);
}

export function filterHistory(agentFilter?: string, cloudFilter?: string): AgentseaRecord[] {
  let records = loadHistory();
  if (agentFilter) {
    const lower = agentFilter.toLowerCase();
    records = records.filter((r) => r.agent.toLowerCase() === lower);
  }
  if (cloudFilter) {
    const lower = cloudFilter.toLowerCase();
    records = records.filter((r) => r.cloud.toLowerCase() === lower);
  }
  // Show newest first (reverse chronological order)
  records.reverse();

  return records;
}
