import type { Manifest } from "./manifest-schema";

export type AgentSortMode = "recommended" | "github-stars" | "name";

export const DEFAULT_AGENT_SORT_MODE: AgentSortMode = "recommended";

const DEFAULT_SORT_PRIORITY = 999;

export function agentSortPriority(m: Manifest, slug: string): number {
  return m.agents[slug]?.sort_priority ?? DEFAULT_SORT_PRIORITY;
}

export function compareAgentSlugs(m: Manifest, a: string, b: string, mode: AgentSortMode): number {
  const aDisabled = m.agents[a]?.disabled ?? false;
  const bDisabled = m.agents[b]?.disabled ?? false;
  if (aDisabled !== bDisabled) {
    return aDisabled ? 1 : -1;
  }

  const aName = m.agents[a]?.name ?? a;
  const bName = m.agents[b]?.name ?? b;

  switch (mode) {
    case "recommended": {
      const ap = agentSortPriority(m, a);
      const bp = agentSortPriority(m, b);
      if (ap !== bp) {
        return ap - bp;
      }
      const astars = m.agents[a]?.github_stars ?? 0;
      const bstars = m.agents[b]?.github_stars ?? 0;
      if (astars !== bstars) {
        return bstars - astars;
      }
      return aName.localeCompare(bName);
    }
    case "github-stars": {
      const astars = m.agents[a]?.github_stars ?? 0;
      const bstars = m.agents[b]?.github_stars ?? 0;
      if (astars !== bstars) {
        return bstars - astars;
      }
      return aName.localeCompare(bName);
    }
    case "name":
      return aName.localeCompare(bName);
  }
}

export function sortAgentSlugs(m: Manifest, slugs: readonly string[], mode: AgentSortMode): string[] {
  return [...slugs].sort((a, b) => compareAgentSlugs(m, a, b, mode));
}

export function allAgentKeys(m: Manifest, mode: AgentSortMode = DEFAULT_AGENT_SORT_MODE): string[] {
  return sortAgentSlugs(m, Object.keys(m.agents), mode);
}

export function agentKeys(m: Manifest): string[] {
  return allAgentKeys(m, "github-stars").filter((k) => !(m.agents[k]?.disabled));
}

export function cloudKeys(m: Manifest): string[] {
  return Object.keys(m.clouds);
}

export function matrixStatus(m: Manifest, cloud: string, agent: string): string {
  return m.matrix[`${cloud}/${agent}`] ?? "missing";
}

export function countImplemented(m: Manifest): number {
  let count = 0;
  for (const value of Object.values(m.matrix)) {
    if (value === "implemented") {
      count++;
    }
  }
  return count;
}
