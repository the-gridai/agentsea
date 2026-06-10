#!/usr/bin/env bun

// local/main.ts — Standalone bundle entry (local.js release asset)

import "../load-env.js";

import { getErrorMessage } from "@agentsea/sdk";
import pkg from "../../package.json" with { type: "json" };
import { initTelemetry } from "../shared/telemetry.js";
import { agents } from "./agents.js";
import { runLocalAgent } from "./run-local-agent.js";

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error("Usage: bun run local/main.ts <agent>");
    console.error(`Agents: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }
  await runLocalAgent(agentName);
}

initTelemetry(pkg.version);
main().catch((err) => {
  process.stderr.write(`\x1b[0;31mFatal: ${getErrorMessage(err)}\x1b[0m\n`);
  process.exit(1);
});
