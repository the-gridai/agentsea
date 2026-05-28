import type { Manifest } from "@grid-spawn/sdk";
import { agentKeys, cloudKeys, matrixStatus } from "@grid-spawn/sdk";

import {
  CHAT_VERIFIED_AGENT_SLUGS,
  HOME_CLOUD_COMING_SOON,
  HOME_CLOUD_SLUGS,
  LINODE_PLACEHOLDER,
} from "./home-public-constants";

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

export function isCloudImplementedForAgent(m: Manifest, cloud: string, agentSlug: string): boolean {
  return matrixStatus(m, cloud, agentSlug) === "implemented";
}

/** Resolve launch cloud from query param — validates agent, cloud, and matrix cell. */
export function resolveLaunchCloud(
  m: Manifest,
  agentSlug: string | undefined,
  cloudSlug: string | undefined,
): { cloudSlug: string; cloudName: string } | null {
  if (!agentSlug || !cloudSlug) return null;
  const agentMeta = m.agents[agentSlug];
  if (!agentMeta || agentMeta.disabled) return null;
  if (HOME_CLOUD_COMING_SOON.has(cloudSlug)) return null;
  if (!isCloudImplementedForAgent(m, cloudSlug, agentSlug)) return null;
  const cloudName = m.clouds[cloudSlug]?.name ?? cloudSlug;
  return { cloudSlug, cloudName };
}

export interface HomeCloudVm {
  slug: string;
  name: string;
  description: string;
  comingSoon: boolean;
  icon: string | null;
}

export function homeCloudOptionsFromManifest(m: Manifest): HomeCloudVm[] {
  return HOME_CLOUD_SLUGS.map((slug) => {
    if (slug === "linode") {
      return {
        slug,
        name: LINODE_PLACEHOLDER.name,
        description: LINODE_PLACEHOLDER.description,
        comingSoon: true,
        icon: null,
      };
    }
    const cloud = m.clouds[slug];
    return {
      slug,
      name: cloud?.name ?? slug,
      description: cloud?.description ?? "",
      comingSoon: HOME_CLOUD_COMING_SOON.has(slug),
      icon: cloud?.icon ?? null,
    };
  });
}

/** Per-agent list of homepage cloud slugs with implemented matrix cells. */
export function homeAgentCloudAvailability(m: Manifest): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const agentSlug of agentKeys(m)) {
    const clouds: string[] = [];
    for (const cloudSlug of HOME_CLOUD_SLUGS) {
      if (HOME_CLOUD_COMING_SOON.has(cloudSlug)) continue;
      if (isCloudImplementedForAgent(m, cloudSlug, agentSlug)) {
        clouds.push(cloudSlug);
      }
    }
    map[agentSlug] = clouds;
  }
  return map;
}

/** Homepage agent card VM — populated from repo `manifest.json` via `@grid-spawn/sdk`. */

export interface HomeAgentVm {
  slug: string;
  name: string;
  desc: string;
  publisher: string;
  /** Label for the per-card metric, or null when no metric is shown. */
  metricLabel: string | null;
  /** Value for the per-card metric, or null when no metric is shown. */
  metricValue: string | null;
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

function formatStars(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
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

    const stars = formatStars(agent.github_stars);

    rows.push({
      slug,
      name: agent.name,
      desc,
      publisher: agent.creator ?? "—",
      metricLabel: stars ? "GitHub stars" : null,
      metricValue: stars,
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

/** Raster logo filename under `public/agents/`, if any. */
export function agentImageFromSlug(slug: string): string | null {
  return ICON_MAP[slug] ?? null;
}
