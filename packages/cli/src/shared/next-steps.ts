import type { Manifest } from "../manifest.js";
import { formatAgentNextSteps } from "@agentsea/sdk";
import pc from "picocolors";

import { AGENTSEA_CLI } from "./cli-invocation.js";
import { logAlwaysInfo } from "./ui.js";

export interface WriteNextStepsOptions {
  /** When true, add a note that the SSH tunnel closes after headless provision. */
  headless?: boolean;
}

/** Print manifest-driven "What's next" guidance after a successful provision. */
export function writeAgentNextSteps(
  agentSlug: string,
  manifest: Manifest,
  options?: WriteNextStepsOptions,
): void {
  const lines = formatAgentNextSteps(manifest, agentSlug, { bullet: "  • " });
  if (lines.length === 0) {
    return;
  }

  process.stderr.write("\n");
  logAlwaysInfo(pc.bold("What's next"));
  for (const line of lines) {
    logAlwaysInfo(line.trimStart());
  }

  if (options?.headless) {
    logAlwaysInfo(
      `  • Re-open dashboards later: ${AGENTSEA_CLI} list → pick your server → Open Dashboard`,
    );
  }

  process.stderr.write("\n");
}
