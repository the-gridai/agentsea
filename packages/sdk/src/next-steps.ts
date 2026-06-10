import type { Manifest, NextStep } from "./manifest-schema";

export type { NextStep, NextStepLink } from "./manifest-schema";

export interface FormatNextStepOptions {
  /** Prefix each line (e.g. "  • " for CLI). Defaults to "• ". */
  bullet?: string;
  /** When true, append link URLs inline (for plain-text CLI). Defaults to true. */
  includeLinkUrl?: boolean;
}

/** Format one next-step bullet as a single line of plain text. */
export function formatNextStepLine(step: NextStep, options?: FormatNextStepOptions): string {
  const bullet = options?.bullet ?? "• ";
  const includeLinkUrl = options?.includeLinkUrl ?? true;
  let line = `${bullet}${step.text}`;
  if (step.link) {
    if (includeLinkUrl) {
      line += ` — ${step.link.label}: ${step.link.url}`;
    } else {
      line += ` — ${step.link.label}`;
    }
  }
  return line;
}

/** Return next steps for an agent slug, or an empty array when unset. */
export function agentNextSteps(manifest: Manifest, agentSlug: string): NextStep[] {
  return manifest.agents[agentSlug]?.next_steps ?? [];
}

/** Format all next steps for an agent as plain-text lines. */
export function formatAgentNextSteps(
  manifest: Manifest,
  agentSlug: string,
  options?: FormatNextStepOptions,
): string[] {
  return agentNextSteps(manifest, agentSlug).map((step) => formatNextStepLine(step, options));
}
