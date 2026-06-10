// agentsea resume - continue provisioning from last recorded phase

import type { AgentseaRecord } from "../history.js";

import * as p from "@clack/prompts";
import { getErrorMessage } from "@agentsea/sdk";
import pc from "picocolors";
import {
  isProvisioningIncomplete,
  listProvisionCheckpoints,
  loadHistory,
  patchAgentseaRecord,
  upsertAgentseaRecord,
} from "../history.js";
import { loadManifest } from "../manifest.js";
import { asyncTryCatch } from "../shared/result.js";
import { resumeOrchestrationFromRecord } from "../shared/orchestrate.js";
import { AGENTSEA_CLI } from "../shared/cli-invocation.js";
import { logError } from "../shared/ui.js";
import { buildRecordLabel, buildRecordSubtitle } from "./list.js";
import { handleCancel, isInteractiveTTY } from "./shared.js";

function findIncompleteFromHistory(): AgentseaRecord[] {
  return loadHistory().filter(isProvisioningIncomplete);
}

/** Merge crash-safe checkpoints into history when the main file missed the write. */
export function recoverProvisionCheckpoints(): number {
  const historyIds = new Set(loadHistory().map((r) => r.id));
  let n = 0;
  for (const rec of listProvisionCheckpoints()) {
    if (!rec.id || !rec.connection) {
      continue;
    }
    if (historyIds.has(rec.id)) {
      continue;
    }
    upsertAgentseaRecord(rec);
    historyIds.add(rec.id);
    n++;
  }
  return n;
}

export async function cmdResume(agentseaId?: string, opts?: { recoverOnly?: boolean }): Promise<void> {
  if (opts?.recoverOnly) {
    const n = recoverProvisionCheckpoints();
    if (n === 0) {
      p.log.info("No new provision checkpoints to import into history.");
    } else {
      p.log.success(`Imported ${n} agentsea record(s) from ~/.config/agentsea/runs/.`);
      p.log.info("Run " + pc.cyan(`${AGENTSEA_CLI} resume`) + " to continue provisioning.");
    }
    return;
  }

  const recovered = recoverProvisionCheckpoints();
  if (recovered > 0) {
    p.log.info(`Recovered ${recovered} checkpoint(s) into history before resume.`);
  }

  const manifestResult = await asyncTryCatch(() => loadManifest());
  if (!manifestResult.ok) {
    logError(`Failed to load manifest: ${getErrorMessage(manifestResult.error)}`);
    process.exit(1);
  }
  const manifest = manifestResult.data;

  const candidates = findIncompleteFromHistory();

  let record: AgentseaRecord | undefined;

  if (agentseaId) {
    record = candidates.find(
      (r) => r.id === agentseaId || r.name === agentseaId || r.connection?.server_name === agentseaId,
    );
    if (!record) {
      logError(
        `No incomplete agentsea matched ${pc.bold(agentseaId)}. Try ` +
          pc.cyan(`${AGENTSEA_CLI} list`) +
          " or " +
          pc.cyan(`${AGENTSEA_CLI} resume --recover`) +
          ".",
      );
      process.exit(1);
    }
  } else if (candidates.length === 1) {
    record = candidates[0];
  } else if (candidates.length === 0) {
    p.log.info("No incomplete spawns in history.");
    p.log.info("If a VM was created but history was lost, run " + pc.cyan(`${AGENTSEA_CLI} resume --recover`) + " first.");
    return;
  } else if (!isInteractiveTTY()) {
    logError(`${AGENTSEA_CLI} resume needs a agentsea id when multiple incomplete spawns exist.`);
    p.log.info("Usage: " + pc.cyan(AGENTSEA_CLI + " resume <agentsea-id>"));
    process.exit(1);
  } else {
    const choice = await p.select({
      message: "Select a agentsea to resume",
      options: candidates.map((r) => ({
        value: r.id,
        label: buildRecordLabel(r),
        hint: buildRecordSubtitle(r, manifest),
      })),
    });
    if (p.isCancel(choice)) {
      handleCancel();
    }
    record = candidates.find((r) => r.id === choice);
  }

  if (!record) {
    logError("Agentsea not found.");
    process.exit(1);
  }

  p.log.step("Resuming " + pc.bold(record.agent) + " on " + pc.bold(record.cloud) + "...");

  const runResult = await asyncTryCatch(() => resumeOrchestrationFromRecord(record!, manifest, undefined));
  if (!runResult.ok) {
    const msg = getErrorMessage(runResult.error);
    patchAgentseaRecord(record.id, {
      provision_status: "failed",
      provision_error: msg.replace(/\s+/g, " ").trim().slice(0, 400),
    });
    logError(msg);
    process.exit(1);
  }
}
