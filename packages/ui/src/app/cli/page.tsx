import type { Metadata } from "next";

import { loadManifest } from "@grid-spawn/sdk/node";

import { agentImageFromSlug, resolveLaunchCloud } from "../landing-from-manifest";
import { SiteHeader } from "../site-header";
import { SpawnLaunchView } from "../spawn-launch-view";
import { CliReference } from "./cli-reference";
import styles from "./page.module.scss";

type CliGuidePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export async function generateMetadata({ searchParams }: CliGuidePageProps): Promise<Metadata> {
  const resolved = (await searchParams) ?? {};
  const agentSlug = firstParam(resolved.agent);
  const cloudParam = firstParam(resolved.cloud);

  const manifest = await loadManifest(false);
  const agentMeta = agentSlug ? manifest.agents[agentSlug] : undefined;
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudParam);

  if (launch && agentMeta) {
    return {
      title: `Launch ${agentMeta.name} on ${launch.cloudName} — Grid Spawn`,
      description: `Install Grid Spawn and launch ${agentMeta.name} on ${launch.cloudName}.`,
    };
  }
  return {
    title: "CLI reference — Grid Spawn",
    description: "Install and use the grid-spawn CLI: commands, environment variables, and tokens.",
  };
}

export default async function CliGuidePage({ searchParams }: CliGuidePageProps) {
  const resolved = (await searchParams) ?? {};
  const agentSlug = firstParam(resolved.agent);
  const cloudParam = firstParam(resolved.cloud);

  const manifest = await loadManifest(false);
  const agentMeta = agentSlug ? manifest.agents[agentSlug] : undefined;
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudParam);

  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        {launch && agentSlug && agentMeta ? (
          <SpawnLaunchView
            agentSlug={agentSlug}
            agentName={agentMeta.name}
            agentImage={agentImageFromSlug(agentSlug)}
            cloudSlug={launch.cloudSlug}
            cloudName={launch.cloudName}
          />
        ) : (
          <CliReference agentSlug={agentSlug} agentName={agentMeta?.name} />
        )}
      </main>
    </div>
  );
}
