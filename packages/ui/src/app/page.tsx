import Link from "next/link";
import { Suspense } from "react";

import { HomeAgentGridStatic } from "./home-agent-grid-static";
import { HomeLaunchFlow } from "./home-launch-flow";
import { THE_GRID_EXTERNAL_URL } from "./home-public-constants";
import { homeAgentCloudAvailability, homeAgentsFromManifest, homeCloudOptionsFromManifest } from "./landing-from-manifest";
import { SiteHeader } from "./site-header";
import styles from "./page.module.scss";

import { loadManifest } from "@agentsea/sdk/node";

export default async function HomePage() {
  const manifest = await loadManifest(false);
  const agents = homeAgentsFromManifest(manifest);
  const cloudOptions = homeCloudOptionsFromManifest(manifest);
  const agentCloudAvailability = homeAgentCloudAvailability(manifest);
  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <div className={styles["shell"]}>
          <section className={styles["hero"]} aria-labelledby="hero-title">
            <h1 id="hero-title" className={styles["hero__title"]}>
              Launch AI agents locally or on the cloud
            </h1>
            <p className={styles["hero__tagline"]}>
              Any agent, on your infrastructure — wired to The Grid API.
            </p>
          </section>

          <Suspense fallback={<HomeAgentGridStatic agents={agents} />}>
            <HomeLaunchFlow
              agents={agents}
              cloudOptions={cloudOptions}
              agentCloudAvailability={agentCloudAvailability}
            />
          </Suspense>
        </div>
      </main>

      <footer className={styles["footer"]}>
        <p>
          <Link href="/cli" className={styles["footer__link"]}>
            CLI Reference
          </Link>
          <span className={styles["footer__sep"]}>·</span>
          <Link href="/why-agentsea" className={styles["footer__link"]}>
            Why AgentSea
          </Link>
          <span className={styles["footer__sep"]}>·</span>
          <Link href="/how-it-works" className={styles["footer__link"]}>
            How it works
          </Link>
          <span className={styles["footer__sep"]}>·</span>
          <a href={THE_GRID_EXTERNAL_URL} rel="noopener noreferrer" className={styles["footer__link"]}>
            The Grid
          </a>
        </p>
      </footer>
    </div>
  );
}
