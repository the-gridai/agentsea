import type { Manifest } from "@grid-spawn/sdk";
import { agentKeys } from "@grid-spawn/sdk";

/** Homepage agent card VM — populated from repo `manifest.json` via `@grid-spawn/sdk`. */

export interface HomeAgentVm {
  slug: string;
  name: string;
  desc: string;
  publisher: string;
  metricLabel: string;
  metricValue: string;
  highlight: boolean;
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
    rows.push({
      slug,
      name: agent.name,
      desc,
      publisher: agent.creator ?? "—",
      metricLabel: "GitHub stars",
      metricValue: formatStars(agent.github_stars),
      highlight: slug === "openclaw",
      image: ICON_MAP[slug] ?? null,
      available,
    });
  }

  rows.push({
    slug: "__more_recipes",
    name: "More via recipes",
    desc: "Ship any agent with a signed recipe + OCI bundle — same provision path.",
    publisher: "The Grid",
    metricLabel: "Packaging",
    metricValue: "OCI + cosign",
    highlight: false,
    image: null,
    available: false,
  });

  return rows;
}
