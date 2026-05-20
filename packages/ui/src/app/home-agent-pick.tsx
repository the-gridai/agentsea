"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useMemo, useState } from "react";

import { GridRecipesLogo } from "./agent-logos";
import type { HomeAgentVm } from "./landing-from-manifest";
import { GRID_SPAWN_REQUEST_AGENT_MAILTO } from "./home-public-constants";
import styles from "./page.module.scss";

export const HomeAgentPick = memo(function HomeAgentPickComp({ agents }: { agents: HomeAgentVm[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(s) || a.desc.toLowerCase().includes(s) || a.publisher.toLowerCase().includes(s),
    );
  }, [agents, q]);

  return (
    <section className={styles["band"]} aria-labelledby="pick-title">
      <div className={styles["sectionHead"]}>
        <span className={styles["sectionHead__index"]} aria-hidden="true">
          1
        </span>
        <h2 id="pick-title" className={styles["sectionHead__title"]}>
          Pick an Agent
        </h2>
      </div>

      <div className={styles["searchRow"]}>
        <label htmlFor="agent-search" className={styles["searchLabel"]}>
          Search agents
        </label>
        <input
          id="agent-search"
          type="search"
          className={styles["searchInput"]}
          placeholder="Search agents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {q.trim() && (
          <p className={styles["searchMeta"]} role="status">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </p>
        )}
      </div>

      <ul className={styles["agentGrid"]}>
        {filtered.map((a) => {
          const clickable = a.chatVerified && a.available;
          const muted = !clickable;

          const cardClass = `${styles["agentCard"]} ${a.highlight ? styles["agentCard--hot"] : ""} ${muted ? styles["agentCard--disabled"] : ""}`.trim();

          const inner = (
            <>
              <div className={styles["agentCard__top"]}>
                <div className={styles["agentCard__logo"]} aria-hidden>
                  {a.image ? (
                    <Image
                      src={`/agents/${a.image}`}
                      alt=""
                      width={44}
                      height={44}
                      className={styles["agentCard__img"]}
                      sizes="44px"
                      unoptimized
                    />
                  ) : (
                    <GridRecipesLogo className={styles["agentCard__logoSvg"]} />
                  )}
                </div>
                <h3 className={styles["agentCard__name"]}>{a.name}</h3>
              </div>
              <p className={styles["agentCard__desc"]}>{a.desc}</p>
              <div className={styles["agentCard__footer"]}>
                <p className={styles["agentCard__publisher"]}>{a.publisher}</p>
                <div className={styles["agentCard__metric"]}>
                  <span className={styles["agentCard__metricLabel"]}>{a.metricLabel}</span>
                  <span className={styles["agentCard__metricValue"]}>{a.metricValue}</span>
                </div>
              </div>
            </>
          );

          return (
            <li key={a.slug}>
              {clickable ? (
                <Link
                  href={`/cli?agent=${encodeURIComponent(a.slug)}`}
                  className={`${cardClass} ${styles["agentCard--clickable"]}`.trim()}
                >
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

      {filtered.length === 0 && (
        <p className={styles["searchEmpty"]} role="status">
          No agents match “{q.trim()}”.{" "}
          <a href={GRID_SPAWN_REQUEST_AGENT_MAILTO} className={styles["inlineLink"]}>
            Request one
          </a>
          .
        </p>
      )}

      <p className={styles["band__foot"]}>
        <a href={GRID_SPAWN_REQUEST_AGENT_MAILTO} className={styles["inlineLink"]}>
          Missing an agent? Request it here
        </a>
        .
      </p>
    </section>
  );
});
