import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { loadManifest } from "@agentsea/sdk/node";

import { agentCloudPath, launchPageMetadata, resolveLaunchCloud } from "../landing-from-manifest";
import { SiteHeader } from "../site-header";
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
      title: "CLI Reference",
      description: "Install and use the agentsea CLI: commands, environment variables, and tokens.",
    };
  }

  const manifest = await loadManifestSafe();
  if (!manifest) {
    return {
      title: "CLI Reference",
      description: "Install and use the agentsea CLI: commands, environment variables, and tokens.",
    };
  }

  const agentMeta = agentSlug ? manifest.agents[agentSlug] : undefined;
  const launch = resolveLaunchCloud(manifest, agentSlug, cloudParam);

  if (launch && agentMeta) {
    return launchPageMetadata(agentSlug!, agentMeta.name, launch.cloudSlug, launch.cloudName);
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

  if (launch && agentSlug && agentMeta) {
    permanentRedirect(agentCloudPath(agentSlug, launch.cloudSlug));
  }

  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <CliReference agentSlug={agentSlug} agentName={agentMeta?.name} />
      </main>
    </div>
  );
}
