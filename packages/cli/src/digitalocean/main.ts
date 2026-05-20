#!/usr/bin/env bun

// digitalocean/main.ts — Orchestrator: deploys an agent on DigitalOcean

import "../load-env.js";

import { getErrorMessage } from "@grid-spawn/sdk";
import pkg from "../../package.json" with { type: "json" };
import { runOrchestration } from "../shared/orchestrate.js";
import { initTelemetry } from "../shared/telemetry.js";
import { agents, resolveAgent } from "./agents.js";
import { createDigitalOceanOrchestrator } from "./provider.js";

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error("Usage: bun run digitalocean/main.ts <agent>");
    console.error(`Agents: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }

  const agent = resolveAgent(agentName);
  const cloud = createDigitalOceanOrchestrator(agentName, agent);

  await runOrchestration(cloud, agent, agentName);
}

initTelemetry(pkg.version);
main().catch((err) => {
  process.stderr.write(`\x1b[0;31mFatal: ${getErrorMessage(err)}\x1b[0m\n`);
  process.exit(1);
});
