"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { HomeAgentPick } from "./home-agent-pick";
import { HomeCloudPick } from "./home-cloud-pick";
import type { HomeAgentVm, HomeCloudVm } from "./landing-from-manifest";

export type HomeLaunchFlowProps = {
  agents: HomeAgentVm[];
  cloudOptions: HomeCloudVm[];
  agentCloudAvailability: Record<string, string[]>;
};

/** Wait for the next *layout-committed* frame, then run cb. Single rAF is not
 *  enough because React commits between RAFs; double-rAF guarantees the DOM
 *  has the new section. */
function afterNextPaint(cb: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(cb);
  });
}

export const HomeLaunchFlow = memo(function HomeLaunchFlowComp({
  agents,
  cloudOptions,
  agentCloudAvailability,
}: HomeLaunchFlowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloudSectionRef = useRef<HTMLElement>(null);
  const cloudTitleRef = useRef<HTMLHeadingElement>(null);
  // Tracks the most recent slug we wrote into the URL ourselves, so we don't
  // re-trigger the URL → state effect with our own write.
  const lastWrittenSlugRef = useRef<string | null>(null);

  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null);

  const handleSelectAgent = useCallback(
    (slug: string) => {
      setSelectedAgentSlug(slug);

      // Sync to URL so back-button, refresh, and shareable links work.
      const next = new URLSearchParams(searchParams.toString());
      next.set("agent", slug);
      lastWrittenSlugRef.current = slug;
      router.replace(`/?${next.toString()}`, { scroll: false });

      afterNextPaint(() => {
        cloudSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        cloudTitleRef.current?.focus();
      });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const agentParam = searchParams.get("agent");
    if (!agentParam) return;
    if (agentParam === lastWrittenSlugRef.current) return;

    const agent = agents.find((a) => a.slug === agentParam);
    if (!agent?.chatVerified || !agent.available || agent.disabled) return;

    setSelectedAgentSlug(agentParam);

    afterNextPaint(() => {
      cloudSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [searchParams, agents]);

  return (
    <>
      <HomeAgentPick
        agents={agents}
        selectedAgentSlug={selectedAgentSlug}
        onSelectAgent={handleSelectAgent}
      />
      <HomeCloudPick
        cloudOptions={cloudOptions}
        agents={agents}
        agentCloudAvailability={agentCloudAvailability}
        selectedAgentSlug={selectedAgentSlug}
        sectionRef={cloudSectionRef}
        titleRef={cloudTitleRef}
      />
    </>
  );
});
