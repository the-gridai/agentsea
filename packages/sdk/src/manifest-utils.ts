import type { Manifest } from "./manifest-schema";

export function agentKeys(m: Manifest): string[] {
  return Object.keys(m.agents)
    .filter((k) => !(m.agents[k]?.disabled))
    .sort((a, b) => (m.agents[b]?.github_stars ?? 0) - (m.agents[a]?.github_stars ?? 0));
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
