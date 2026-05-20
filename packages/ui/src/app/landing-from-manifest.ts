import type { Manifest } from "@grid-spawn/sdk";
import { agentKeys, cloudKeys, matrixStatus } from "@grid-spawn/sdk";

import { CHAT_VERIFIED_AGENT_SLUGS } from "./home-public-constants";

const CHAT_VERIFIED_ORDER = new Map<string, number>(
  CHAT_VERIFIED_AGENT_SLUGS.map((slug, i) => [slug, i]),
);

/** First cloud key (manifest order) with an implemented matrix cell for this agent, or null. */
export function firstImplementedCloudForAgent(m: Manifest, agentSlug: string): string | null {
  for (const cloud of cloudKeys(m)) {
    if (matrixStatus(m, cloud, agentSlug) === "implemented") {
      return cloud;
    }
  }
  return null;
}

/** Homepage agent card VM — populated from repo `manifest.json` via `@grid-spawn/sdk`. */

export interface HomeAgentVm {
  slug: string;
  name: string;
  desc: string;
  publisher: string;
  metricLabel: string;
  metricValue: string;
  highlight: boolean;
  chatVerified: boolean;
  image: string | null;
  available: boolean;
}

const ICON_MAP: Record<string, string> = {
  openclaw: "openclaw.png",
  claude: "claude.png",
  codex: "codex.png",
  opencode: "opencode.png",
  kilocode: "kilocode.png",
  hermes: "hermes.png",
  junie: "junie.png",
  pi: "pi.png",
  cursor: "cursor.png",
  t3code: "t3code.png",
};

function formatStars(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M★`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k★`;
  return `${n}★`;
}

export function homeAgentsFromManifest(m: Manifest): HomeAgentVm[] {
  const rows: HomeAgentVm[] = [];

  for (const slug of agentKeys(m)) {
    const agent = m.agents[slug];
    if (!agent) continue;

    let implementedCells = 0;
    for (const [cell, status] of Object.entries(m.matrix)) {
      if (!cell.endsWith(`/${slug}`)) continue;
      if (status === "implemented") implementedCells++;
    }
    const available = implementedCells > 0;

    const desc = agent.tagline?.trim() || agent.description;
    const chatVerified = CHAT_VERIFIED_ORDER.has(slug);

    rows.push({
      slug,
      name: agent.name,
      desc,
      publisher: agent.creator ?? "—",
      metricLabel: "GitHub stars",
      metricValue: formatStars(agent.github_stars),
      highlight: chatVerified,
      chatVerified,
      image: ICON_MAP[slug] ?? null,
      available,
    });
  }

  rows.sort((a, b) => {
    const aRank = CHAT_VERIFIED_ORDER.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const bRank = CHAT_VERIFIED_ORDER.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });

  return rows;
}
