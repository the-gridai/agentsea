"use client";

import Image from "next/image";
import { memo, useMemo, useState } from "react";

import { GridRecipesLogo } from "./agent-logos";
import type { HomeAgentVm } from "./landing-from-manifest";
import { GRID_SPAWN_REQUEST_AGENT_MAILTO } from "./home-public-constants";
import styles from "./page.module.scss";

export type HomeAgentPickProps = {
  agents: HomeAgentVm[];
  selectedAgentSlug: string | null;
  onSelectAgent: (slug: string) => void;
};

export const HomeAgentPick = memo(function HomeAgentPickComp({
  agents,
  selectedAgentSlug,
  onSelectAgent,
}: HomeAgentPickProps) {
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
          placeholder="by name, publisher, or description"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          inputMode="search"
          aria-describedby={q.trim() ? "agent-search-meta" : undefined}
        />
        {q.trim() && (
          <p id="agent-search-meta" className={styles["searchMeta"]} aria-live="polite">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </p>
        )}
      </div>

      <ul className={styles["agentGrid"]}>
        {filtered.map((a) => {
          const selectable = a.chatVerified && a.available;
          const muted = !selectable;
          const selected = selectedAgentSlug === a.slug;

          let disabledReason: string | null = null;
          if (!a.available) {
            disabledReason = "Coming soon";
          } else if (!a.chatVerified) {
            disabledReason = "In testing";
          }

          const cardClass = [
            styles["agentCard"],
            a.highlight ? styles["agentCard--hot"] : "",
            muted ? styles["agentCard--disabled"] : "",
            selectable ? styles["agentCard--clickable"] : "",
            selected ? styles["agentCard--selected"] : "",
          ]
            .filter(Boolean)
            .join(" ");

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
                    />
                  ) : (
                    <GridRecipesLogo className={styles["agentCard__logoSvg"]} />
                  )}
                </div>
                <div className={styles["agentCard__head"]}>
                  <h3 className={styles["agentCard__name"]}>{a.name}</h3>
                  {disabledReason && (
                    <span className={styles["agentCard__badge"]}>{disabledReason}</span>
                  )}
                </div>
              </div>
              <p className={styles["agentCard__desc"]} title={muted ? a.desc : undefined}>
                {a.desc}
              </p>
              <div className={styles["agentCard__footer"]}>
                <p className={styles["agentCard__publisher"]}>{a.publisher}</p>
                {a.metricLabel && a.metricValue && (
                  <div className={styles["agentCard__metric"]}>
                    <span className={styles["agentCard__metricLabel"]}>{a.metricLabel}</span>
                    <span className={styles["agentCard__metricValue"]}>{a.metricValue}</span>
                  </div>
                )}
              </div>
            </>
          );

          return (
            <li key={a.slug}>
              {selectable ? (
                <button
                  type="button"
                  className={cardClass}
                  aria-pressed={selected}
                  onClick={() => onSelectAgent(a.slug)}
                >
                  {inner}
                </button>
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
