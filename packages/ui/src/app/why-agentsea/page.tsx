import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "../site-header";
import { WHY_AGENTSEA_CARDS } from "../why-agentsea-cards";
import styles from "../cli/page.module.scss";
import homeStyles from "../page.module.scss";

export const metadata: Metadata = {
  title: "Why AgentSea",
  description:
    "AgentSea is the fastest way to deploy Grid-backed AI agents on infrastructure you control — agent-agnostic, bring your own cloud, fully sandboxed.",
  openGraph: {
    title: "Why AgentSea",
    description:
      "AgentSea is the fastest way to deploy Grid-backed AI agents on infrastructure you control — agent-agnostic, bring your own cloud, fully sandboxed.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Why AgentSea",
    description:
      "AgentSea is the fastest way to deploy Grid-backed AI agents on infrastructure you control — agent-agnostic, bring your own cloud, fully sandboxed.",
  },
};

export default function WhyAgentSeaPage() {
  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <div className={styles["reference"]}>
          <header className={styles["referenceHero"]}>
            <h1 className={styles["referenceHero__title"]}>Why AgentSea?</h1>
            <p className={styles["referenceHero__p"]}>
              The fastest way to deploy Grid-backed agents on infrastructure you control. Pick an agent and
              environment on the{" "}
              <Link href="/" className={styles["fallback__link"]}>
                homepage
              </Link>{" "}
              to get a tailored deploy guide.
            </p>
          </header>

          <div className={homeStyles["whyGrid"]}>
            {WHY_AGENTSEA_CARDS.map((c) => (
              <div key={c.title} className={homeStyles["whyCard"]}>
                <h2 className={homeStyles["whyCard__h"]}>{c.title}</h2>
                <p className={homeStyles["whyCard__p"]}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
