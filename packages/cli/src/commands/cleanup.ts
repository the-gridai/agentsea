// agentsea cleanup — remove stale provider resources tagged by AgentSea (opt-in, DigitalOcean first).

import * as p from "@clack/prompts";
import pc from "picocolors";
import { getErrorMessage } from "@agentsea/sdk";
import { asyncTryCatch } from "../shared/result.js";
import { AGENTSEA_CLI } from "../shared/cli-invocation.js";
import { handleCancel, isInteractiveTTY } from "./shared.js";

const DEFAULT_TTL_HOURS = 168;

export async function cmdCleanup(
  cloudArg: string | undefined,
  opts: {
    dryRun?: boolean;
    olderThanHours?: number;
    forceYes?: boolean;
  },
): Promise<void> {
  const ttlHours = opts.olderThanHours ?? DEFAULT_TTL_HOURS;
  const olderMs = ttlHours * 3600 * 1000;
  const now = Date.now();

  const cloud = (cloudArg ?? "digitalocean").toLowerCase();

  if (cloud !== "digitalocean") {
    p.log.error(`Cleanup is only implemented for ${pc.cyan("digitalocean")} today.`);
    process.exit(1);
  }

  const doMod = await import("../digitalocean/digitalocean.js");
  const tokenResult = await asyncTryCatch(() => doMod.ensureDoToken());
  if (!tokenResult.ok) {
    p.log.error("DigitalOcean authentication failed.");
    process.exit(1);
  }

  const listResult = await asyncTryCatch(() => doMod.listAgentSeaDroplets());
  if (!listResult.ok) {
    p.log.error(`Could not list droplets: ${getErrorMessage(listResult.error)}`);
    process.exit(1);
  }

  const stale = listResult.data.filter((d) => {
    if (!d.createdAt) {
      return false;
    }
    const t = Date.parse(d.createdAt);
    if (!Number.isFinite(t)) {
      return false;
    }
    return now - t > olderMs;
  });

  if (stale.length === 0) {
    p.log.info(`No droplets tagged ${pc.dim(doMod.AGENTSEA_DIGITALOCEAN_ATTRIBUTION_TAG)} older than ${ttlHours}h.`);
    return;
  }

  p.log.message(
    pc.dim(
      `Droplets older than ${ttlHours}h (${stale.length}):`,
    ),
  );
  for (const d of stale) {
    console.log(`  ${pc.bold(d.id)}  ${d.name}  ${d.createdAt}`);
  }

  if (opts.dryRun) {
    p.log.info(pc.dim("Dry run — no changes."));
    return;
  }

  let confirmed = opts.forceYes === true;
  if (!confirmed && isInteractiveTTY()) {
    const answer = await p.confirm({
      message: `Destroy ${stale.length} droplet(s)? This cannot be undone.`,
      initialValue: false,
    });
    if (p.isCancel(answer)) {
      handleCancel();
    }
    confirmed = answer === true;
  }

  if (!confirmed) {
    if (!isInteractiveTTY()) {
      p.log.error(`${AGENTSEA_CLI} cleanup requires ${pc.cyan("--yes")} when not running interactively.`);
      process.exit(1);
    }
    p.log.info("Cancelled.");
    return;
  }

  for (const d of stale) {
    const dr = await asyncTryCatch(() => doMod.destroyServer(d.id));
    if (!dr.ok) {
      p.log.warn(`Failed to destroy ${d.id}: ${getErrorMessage(dr.error)}`);
    } else {
      p.log.success(`Destroyed ${d.id}`);
    }
  }
}
