import Image from "next/image";

import { GridRecipesLogo } from "./agent-logos";
import { AGENT_SORT_OPTIONS, DEFAULT_AGENT_SORT_MODE } from "./landing-from-manifest";
import type { HomeAgentVm } from "./landing-from-manifest";
import styles from "./page.module.scss";

function agentCardDisabledReason(a: HomeAgentVm): string | null {
  if (a.disabled) {
    return "Coming soon";
  }
  if (!a.available) {
    return "Coming soon";
  }
  if (!a.chatVerified) {
    return "In testing";
  }
  return null;
}

/**
 * Server-rendered, non-interactive version of the agent grid. Used as the
 * Suspense fallback for the client-side picker so the page is meaningful
 * during streaming, with JS disabled, and to crawlers — instead of the
 * previous `fallback={null}` blank.
 *
 * Renders the same Step 1 chrome and cards as `HomeAgentPick` but without
 * search state or selection handlers. The client picker fully replaces this
 * once it hydrates.
 */
export function HomeAgentGridStatic({ agents }: { agents: HomeAgentVm[] }) {
  const defaultSortLabel =
    AGENT_SORT_OPTIONS.find((opt) => opt.value === DEFAULT_AGENT_SORT_MODE)?.label ?? "Recommended";

  return (
    <section className={styles["band"]} aria-labelledby="pick-title">
      <div className={styles["sectionHead"]}>
        <div className={styles["sectionHead__lead"]}>
          <span className={styles["sectionHead__index"]} aria-hidden="true">
            1
          </span>
          <h2 id="pick-title" className={styles["sectionHead__title"]}>
            Pick an Agent
          </h2>
        </div>
        <div className={styles["sectionHead__sort"]}>
          <span className={styles["sectionHead__sortLabel"]}>Sort</span>
          <span className={styles["sectionHead__sortSelect"]} aria-hidden="true">
            {defaultSortLabel}
          </span>
        </div>
      </div>

      <ul className={styles["agentGrid"]}>
        {agents.map((a) => {
          const selectable = !a.disabled && a.chatVerified && a.available;
          const muted = !selectable;
          const disabledReason = agentCardDisabledReason(a);

          const cardClass = [
            styles["agentCard"],
            a.highlight ? styles["agentCard--hot"] : "",
            muted ? styles["agentCard--disabled"] : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={a.slug}>
              <div
                className={cardClass}
                aria-disabled={muted ? "true" : undefined}
                title={a.disabled && a.disabledReason ? a.disabledReason : undefined}
              >
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
                <p className={styles["agentCard__desc"]}>{a.desc}</p>
                <div className={styles["agentCard__footer"]}>
                  <p className={styles["agentCard__publisher"]}>{a.publisher}</p>
                  {a.metricLabel && a.metricValue && (
                    <div className={styles["agentCard__metric"]}>
                      <span className={styles["agentCard__metricLabel"]}>{a.metricLabel}</span>
                      <span className={styles["agentCard__metricValue"]}>{a.metricValue}</span>
                    </div>
                  )}
                </div>
                <span className={styles["agentCard__hoverBot"]} aria-hidden>
                  <span className={styles["agentCard__hoverBotEye"]} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
