import type { Metadata } from "next";
import type { AgentSortMode, Manifest } from "@agentsea/sdk";
import {
  agentKeys,
  allAgentKeys,
  cloudKeys,
  DEFAULT_AGENT_SORT_MODE,
  matrixStatus,
} from "@agentsea/sdk";

import {
  CHAT_VERIFIED_AGENT_SLUGS,
  HOME_CLOUD_COMING_SOON,
  HOME_CLOUD_SLUGS,
  LINODE_PLACEHOLDER,
} from "./home-public-constants";

const CHAT_VERIFIED_ORDER = new Map<string, number>(
  CHAT_VERIFIED_AGENT_SLUGS.map((slug, i) => [slug, i]),
);

export { DEFAULT_AGENT_SORT_MODE };
export type { AgentSortMode };

export const AGENT_SORT_OPTIONS: ReadonlyArray<{ value: AgentSortMode; label: string }> = [
  { value: "recommended", label: "Recommended" },
  { value: "github-stars", label: "GitHub stars" },
  { value: "name", label: "Name" },
];

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

/** Cloud slugs included in sitemap and static `/{agent}/{cloud}` routes. */
export const INDEXED_CLOUD_SLUGS = [
  "local",
  "digitalocean",
  "hetzner",
  "aws",
  "gcp",
  "daytona",
  "sprite",
] as const;

export function agentCloudPath(agentSlug: string, cloudSlug: string): string {
  return `/${agentSlug}/${cloudSlug}`;
}

/** Human-readable environment name for titles, H1s, and meta (e.g. `local` → Local Machine). */
export function displayCloudName(cloudSlug: string, cloudName: string): string {
  if (cloudSlug === "local") return "Local Machine";
  return cloudName;
}

/** Implemented agent×cloud pairs for sitemap and `generateStaticParams`. */
export function implementedAgentCloudPairs(m: Manifest): Array<{ agent: string; cloud: string }> {
  const pairs: Array<{ agent: string; cloud: string }> = [];
  for (const agentSlug of agentKeys(m)) {
    for (const cloudSlug of INDEXED_CLOUD_SLUGS) {
      if (isCloudImplementedForAgent(m, cloudSlug, agentSlug)) {
        pairs.push({ agent: agentSlug, cloud: cloudSlug });
      }
    }
  }
  return pairs;
}

function publicOriginBase(): string {
  return process.env.NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN?.replace(/\/+$/, "") ?? "https://spawn.thegrid.ai";
}

/** Per-route title, description, canonical URL, and Open Graph / Twitter tags for launch pages. */
export function launchPageMetadata(
  agentSlug: string,
  agentName: string,
  cloudSlug: string,
  cloudName: string,
): Metadata {
  const environment = displayCloudName(cloudSlug, cloudName);
  const title = `Deploy ${agentName} on ${environment}`;
  const description = `Deploy ${agentName} on ${environment} with AgentSea — one command installs the CLI and starts your deployment (agentsea ${agentSlug} ${cloudSlug}). Grid-backed inference on infrastructure you control.`;
  const url = `${publicOriginBase()}${agentCloudPath(agentSlug, cloudSlug)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
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
  const rawName = m.clouds[cloudSlug]?.name ?? cloudSlug;
  const cloudName = displayCloudName(cloudSlug, rawName);
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
    const rawName = cloud?.name ?? slug;
    return {
      slug,
      name: displayCloudName(slug, rawName),
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

/** Homepage agent card VM — populated from repo `manifest.json` via `@agentsea/sdk`. */

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
  disabled: boolean;
  disabledReason: string | null;
  githubStars: number | undefined;
  sortPriority: number;
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

export function sortHomeAgents(agents: readonly HomeAgentVm[], mode: AgentSortMode): HomeAgentVm[] {
  return [...agents].sort((a, b) => {
    if (a.disabled !== b.disabled) {
      return a.disabled ? 1 : -1;
    }

    switch (mode) {
      case "recommended": {
        if (a.sortPriority !== b.sortPriority) {
          return a.sortPriority - b.sortPriority;
        }
        const aStars = a.githubStars ?? 0;
        const bStars = b.githubStars ?? 0;
        if (aStars !== bStars) {
          return bStars - aStars;
        }
        return a.name.localeCompare(b.name);
      }
      case "github-stars": {
        const aStars = a.githubStars ?? 0;
        const bStars = b.githubStars ?? 0;
        if (aStars !== bStars) {
          return bStars - aStars;
        }
        return a.name.localeCompare(b.name);
      }
      case "name":
        return a.name.localeCompare(b.name);
    }
  });
}

export function homeAgentsFromManifest(
  m: Manifest,
  mode: AgentSortMode = DEFAULT_AGENT_SORT_MODE,
): HomeAgentVm[] {
  const rows: HomeAgentVm[] = [];

  for (const slug of allAgentKeys(m, mode)) {
    const agent = m.agents[slug];
    if (!agent) continue;

    let implementedCells = 0;
    for (const [cell, status] of Object.entries(m.matrix)) {
      if (!cell.endsWith(`/${slug}`)) continue;
      if (status === "implemented") implementedCells++;
    }
    const available = implementedCells > 0;
    const disabled = agent.disabled === true;

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
      highlight: chatVerified && !disabled,
      chatVerified,
      image: ICON_MAP[slug] ?? null,
      available,
      disabled,
      disabledReason: agent.disabled_reason?.trim() || null,
      githubStars: agent.github_stars,
      sortPriority: agent.sort_priority ?? 999,
    });
  }

  return sortHomeAgents(rows, mode);
}

/** Raster logo filename under `public/agents/`, if any. */
export function agentImageFromSlug(slug: string): string | null {
  return ICON_MAP[slug] ?? null;
}
