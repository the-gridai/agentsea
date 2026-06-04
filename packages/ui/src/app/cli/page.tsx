import type { Metadata } from "next";

import { loadManifest } from "@agentsea/sdk/node";

import { agentImageFromSlug, resolveLaunchCloud } from "../landing-from-manifest";
import { SiteHeader } from "../site-header";
import { AgentseaLaunchView } from "../agentsea-launch-view";
import { CliReference } from "./cli-reference";
import styles from "./page.module.scss";

type CliGuidePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function loadManifestSafe() {
  try {
    return await loadManifest(false);
  } catch (error) {
    console.error("[/cli] failed to load manifest", error);
    return null;
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export async function generateMetadata({ searchParams }: CliGuidePageProps): Promise<Metadata> {
  const resolved = (await searchParams) ?? {};
  const agentSlug = firstParam(resolved.agent);
  const cloudParam = firstParam(resolved.cloud);

  if (!agentSlug && !cloudParam) {
    return {
      title: "CLI reference — AgentSea",
      description: "Install and use the agentsea CLI: commands, environment variables, and tokens.",
    };
  }

  const manifest = await loadManifestSafe();
  if (!manifest) {
    return {
      title: "CLI reference — AgentSea",
      description: "Install and use the agentsea CLI: commands, environment variables, and tokens.",
    };
  }

  const agentMeta = agentSlug ? manifest.agents[agentSlug] : undefined;
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudParam);

  if (launch && agentMeta) {
    return {
      title: `Launch ${agentMeta.name} on ${launch.cloudName} — AgentSea`,
      description: `Install AgentSea and launch ${agentMeta.name} on ${launch.cloudName}.`,
    };
  }
  return {
    title: "CLI reference — AgentSea",
    description: "Install and use the agentsea CLI: commands, environment variables, and tokens.",
  };
}

export default async function CliGuidePage({ searchParams }: CliGuidePageProps) {
  const resolved = (await searchParams) ?? {};
  const agentSlug = firstParam(resolved.agent);
  const cloudParam = firstParam(resolved.cloud);

  const manifest = agentSlug || cloudParam ? await loadManifestSafe() : null;
  const agentMeta = manifest && agentSlug ? manifest.agents[agentSlug] : undefined;
  const launch = manifest ? resolveLaunchCloud(manifest, agentSlug, cloudParam) : null;

  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        {launch && agentSlug && agentMeta ? (
          <AgentseaLaunchView
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
