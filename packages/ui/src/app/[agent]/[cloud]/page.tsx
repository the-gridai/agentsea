import { notFound } from "next/navigation";

import { AgentseaLaunchView } from "../../agentsea-launch-view";
import {
  agentImageFromSlug,
  implementedAgentCloudPairs,
  launchPageMetadata,
  resolveLaunchCloud,
} from "../../landing-from-manifest";
import { SiteHeader } from "../../site-header";
import styles from "../../cli/page.module.scss";

import { loadManifest } from "@agentsea/sdk/node";

type PageProps = {
  params: Promise<{ agent: string; cloud: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { agent: agentSlug, cloud: cloudSlug } = await params;
  const manifest = await loadManifest(false);
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudSlug);
  if (!launch) {
    return { title: "AgentSea" };
  }
  const agentName = manifest.agents[agentSlug]?.name ?? agentSlug;
  return launchPageMetadata(agentSlug, agentName, launch.cloudSlug, launch.cloudName);
}

export async function generateStaticParams() {
  const manifest = await loadManifest(false);
  return implementedAgentCloudPairs(manifest);
}

export default async function AgentCloudPage({ params }: PageProps) {
  const { agent: agentSlug, cloud: cloudSlug } = await params;
  const manifest = await loadManifest(false);
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudSlug);
  if (!launch) {
    notFound();
  }

  const agentMeta = manifest.agents[agentSlug]!;

  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <AgentseaLaunchView
          agentSlug={agentSlug}
          agentName={agentMeta.name}
          agentImage={agentImageFromSlug(agentSlug)}
          cloudSlug={launch.cloudSlug}
          cloudName={launch.cloudName}
          nextSteps={agentMeta.next_steps}
        />
      </main>
    </div>
  );
}
