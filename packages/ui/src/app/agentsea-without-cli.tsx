"use client";

import { useSearchParams } from "next/navigation";
import { memo, useMemo } from "react";

import { AgentseaCopyBlock } from "./agentsea-copy-block";
import type { HomeAgentVm, HomeCloudVm } from "./landing-from-manifest";
import styles from "./page.module.scss";

/** Default combo when no agent is selected (or the selection isn't launchable). */
const DEFAULT_AGENT_SLUG = "openclaw";
const DEFAULT_AGENT_NAME = "OpenClaw";
const DEFAULT_CLOUD_SLUG = "digitalocean";
const DEFAULT_CLOUD_NAME = "DigitalOcean";

export type WithoutCliProps = {
  origin: string;
  agents: HomeAgentVm[];
  cloudOptions: HomeCloudVm[];
  agentCloudAvailability: Record<string, string[]>;
};

function buildSnippet(origin: string, cloudSlug: string, agentSlug: string): string {
  return `bash <(curl -fsSL ${origin}/${cloudSlug}/${agentSlug}.sh)`;
}

/** Prefer DigitalOcean when available for the agent, else the first available cloud. */
function pickCloudSlug(availability: string[] | undefined): string {
  if (!availability || availability.length === 0) return DEFAULT_CLOUD_SLUG;
  return availability.includes(DEFAULT_CLOUD_SLUG) ? DEFAULT_CLOUD_SLUG : (availability[0] ?? DEFAULT_CLOUD_SLUG);
}

/** Presentational section — also used as the Suspense fallback (default combo). */
export const WithoutCliSection = memo(function WithoutCliSectionComp({
  origin,
  agentName = DEFAULT_AGENT_NAME,
  agentSlug = DEFAULT_AGENT_SLUG,
  cloudName = DEFAULT_CLOUD_NAME,
  cloudSlug = DEFAULT_CLOUD_SLUG,
}: {
  origin: string;
  agentName?: string;
  agentSlug?: string;
  cloudName?: string;
  cloudSlug?: string;
}) {
  return (
    <section className={styles["band"]} aria-labelledby="without-cli-title">
      <h2 id="without-cli-title" className={styles["h2"]}>
        Without the CLI
      </h2>
      <p className={styles["lede"]}>
        One curl command to launch <strong>{agentName}</strong> on <strong>{cloudName}</strong>. No global
        install.
      </p>
      <div className={styles["withoutCliCopy"]}>
        <AgentseaCopyBlock code={buildSnippet(origin, cloudSlug, agentSlug)} />
      </div>
    </section>
  );
});

/**
 * Reflects the agent the visitor picked above (shared via the `?agent=` URL param
 * set by HomeLaunchFlow), defaulting to OpenClaw × DigitalOcean. Must be rendered
 * inside a <Suspense> boundary because it reads useSearchParams.
 */
export const WithoutCli = memo(function WithoutCliComp({
  origin,
  agents,
  cloudOptions,
  agentCloudAvailability,
}: WithoutCliProps) {
  const searchParams = useSearchParams();
  const agentParam = searchParams.get("agent");

  const resolved = useMemo(() => {
    // Mirror HomeLaunchFlow: only honor agents that are launchable (available + chat-verified).
    const selected = agentParam ? agents.find((a) => a.slug === agentParam) : undefined;
    const valid = selected && !selected.disabled && selected.available && selected.chatVerified ? selected : undefined;
    if (!valid) {
      return {
        agentSlug: DEFAULT_AGENT_SLUG,
        agentName: DEFAULT_AGENT_NAME,
        cloudSlug: DEFAULT_CLOUD_SLUG,
        cloudName: DEFAULT_CLOUD_NAME,
      };
    }
    const cloudSlug = pickCloudSlug(agentCloudAvailability[valid.slug]);
    const cloudName = cloudOptions.find((c) => c.slug === cloudSlug)?.name ?? cloudSlug;
    return { agentSlug: valid.slug, agentName: valid.name, cloudSlug, cloudName };
  }, [agentParam, agents, cloudOptions, agentCloudAvailability]);

  return (
    <WithoutCliSection
      origin={origin}
      agentSlug={resolved.agentSlug}
      agentName={resolved.agentName}
      cloudSlug={resolved.cloudSlug}
      cloudName={resolved.cloudName}
    />
  );
});
