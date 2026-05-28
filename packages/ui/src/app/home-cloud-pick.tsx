"use client";

import Link from "next/link";
import { memo, type RefObject } from "react";

import { CloudLogo } from "./cloud-logos";
import type { HomeAgentVm, HomeCloudVm } from "./landing-from-manifest";
import styles from "./page.module.scss";

export type HomeCloudPickProps = {
  cloudOptions: HomeCloudVm[];
  agents: HomeAgentVm[];
  agentCloudAvailability: Record<string, string[]>;
  selectedAgentSlug: string | null;
  sectionRef: RefObject<HTMLElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
};

function cliHref(agentSlug: string, cloudSlug: string): string {
  return `/cli?agent=${encodeURIComponent(agentSlug)}&cloud=${encodeURIComponent(cloudSlug)}`;
}

export const HomeCloudPick = memo(function HomeCloudPickComp({
  cloudOptions,
  agents,
  agentCloudAvailability,
  selectedAgentSlug,
  sectionRef,
  titleRef,
}: HomeCloudPickProps) {
  if (!selectedAgentSlug) return null;

  const agent = agents.find((a) => a.slug === selectedAgentSlug);
  const availableClouds = agentCloudAvailability[selectedAgentSlug] ?? [];

  return (
    <section ref={sectionRef} className={styles["band"]} aria-labelledby="cloud-pick-title">
      <div className={styles["sectionHead"]}>
        <span className={styles["sectionHead__index"]} aria-hidden="true">
          2
        </span>
        <h2 id="cloud-pick-title" ref={titleRef} className={styles["sectionHead__title"]} tabIndex={-1}>
          Pick where to run
        </h2>
      </div>

      <p className={styles["cloudPickLead"]}>
        Where should <strong>{agent?.name ?? selectedAgentSlug}</strong> run?
      </p>

      <ul className={styles["cloudGrid"]}>
        {cloudOptions.map((c) => {
          const comingSoon = c.comingSoon;
          const availableForAgent = !comingSoon && availableClouds.includes(c.slug);
          const selectable = availableForAgent;

          let disabledReason: string | null = null;
          if (comingSoon) {
            disabledReason = "Coming soon";
          } else if (!availableForAgent) {
            disabledReason = `Not yet supported for ${agent?.name ?? "this agent"}`;
          }

          const cardClass = [
            styles["cloudCard"],
            selectable ? styles["cloudCard--clickable"] : "",
            !selectable ? styles["cloudCard--disabled"] : "",
          ]
            .filter(Boolean)
            .join(" ");

          const inner = (
            <>
              <div className={styles["cloudCard__top"]}>
                <div className={styles["cloudCard__logo"]} aria-hidden>
                  <CloudLogo
                    slug={c.slug}
                    icon={c.icon}
                    size={44}
                    imgClassName={styles["cloudCard__img"]}
                    svgClassName={styles["cloudCard__logoSvg"]}
                  />
                </div>
                <div className={styles["cloudCard__head"]}>
                  <h3 className={styles["cloudCard__name"]}>{c.name}</h3>
                  {disabledReason && (
                    <span className={styles["cloudCard__badge"]}>{disabledReason}</span>
                  )}
                </div>
              </div>
              <p className={styles["cloudCard__desc"]}>{c.description}</p>
            </>
          );

          return (
            <li key={c.slug}>
              {selectable ? (
                <Link href={cliHref(selectedAgentSlug, c.slug)} className={cardClass}>
                  {inner}
                </Link>
              ) : (
                <div className={cardClass} aria-disabled="true">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
});
