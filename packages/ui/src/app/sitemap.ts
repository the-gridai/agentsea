import type { MetadataRoute } from "next";

import { implementedAgentCloudPairs, agentCloudPath } from "./landing-from-manifest";

import { loadManifest } from "@agentsea/sdk/node";

function publicOriginBase(): string {
  return process.env.NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN?.replace(/\/+$/, "") ?? "https://spawn.thegrid.ai";
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const manifest = await loadManifest(false);
  const base = publicOriginBase();
  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date() },
    { url: `${base}/cli`, lastModified: new Date() },
    { url: `${base}/why-agentsea`, lastModified: new Date() },
    { url: `${base}/how-it-works`, lastModified: new Date() },
  ];

  for (const { agent, cloud } of implementedAgentCloudPairs(manifest)) {
    entries.push({
      url: `${base}${agentCloudPath(agent, cloud)}`,
      lastModified: new Date(),
    });
  }

  return entries;
}
