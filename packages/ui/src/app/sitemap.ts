import type { MetadataRoute } from "next";

import { implementedAgentCloudPairs, agentCloudPath } from "./landing-from-manifest";

import { loadManifest } from "@agentsea/sdk/node";

function publicOriginBase(): string {
  return process.env.NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN?.replace(/\/+$/, "") ?? "https://agentsea.thegrid.ai";
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const manifest = await loadManifest(false);
  const base = publicOriginBase();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/` },
    { url: `${base}/cli` },
    { url: `${base}/why-agentsea` },
    { url: `${base}/how-it-works` },
  ];

  for (const { agent, cloud } of implementedAgentCloudPairs(manifest)) {
    entries.push({
      url: `${base}${agentCloudPath(agent, cloud)}`,
    });
  }

  return entries;
}
