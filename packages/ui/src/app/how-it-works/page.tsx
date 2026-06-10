import type { Metadata } from "next";
import Link from "next/link";

import { CopyCode } from "../copy-code";
import { hoodStepsForCloud } from "../how-it-works-steps";
import {
  AGENTSEA_INSTALL_URL,
  AGENTSEA_PUBLIC_ORIGIN,
  THE_GRID_EXTERNAL_URL,
} from "../home-public-constants";
import { SiteHeader } from "../site-header";
import styles from "../cli/page.module.scss";
import homeStyles from "../page.module.scss";

const INSTALL_SNIPPET = `curl -fsSL ${AGENTSEA_INSTALL_URL} | bash`;

const PREREQUISITES = ["bash", "curl", "ssh", "jq"] as const;

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How AgentSea provisions cloud VMs, wires The Grid API, and connects you to interactive AI agents — from install to SSH session.",
  openGraph: {
    title: "How it works — AgentSea",
    description:
      "How AgentSea provisions cloud VMs, wires The Grid API, and connects you to interactive AI agents — from install to SSH session.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "How it works — AgentSea",
    description:
      "How AgentSea provisions cloud VMs, wires The Grid API, and connects you to interactive AI agents — from install to SSH session.",
  },
};

export default function HowItWorksPage() {
  const localSteps = hoodStepsForCloud("local");
  const cloudSteps = hoodStepsForCloud("digitalocean");

  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <div className={styles["reference"]}>
          <header className={styles["referenceHero"]}>
            <h1 className={styles["referenceHero__title"]}>How it works</h1>
            <p className={styles["referenceHero__p"]}>
              Two layers: <strong>your laptop</strong> (install the CLI once), then <strong>your environment</strong>{" "}
              (local machine or cloud VM). For step-by-step deploy commands, pick an agent on the{" "}
              <Link href="/" className={styles["fallback__link"]}>
                homepage
              </Link>
              .
            </p>
          </header>

          <section className={styles["referenceSection"]} aria-labelledby="hiw-install">
            <h2 id="hiw-install" className={styles["referenceSection__h"]}>
              One-time install
            </h2>
            <p className={styles["referenceSection__p"]}>
              Paste into a terminal (macOS, Linux, or WSL). When it finishes, the{" "}
              <code className={styles["inlineCode"]}>agentsea</code> command should work. Prerequisites:{" "}
              {PREREQUISITES.map((t) => (
                <code key={t} className={styles["inlineCode"]}>
                  {t}
                </code>
              )).flatMap((el, i) => (i === 0 ? [el] : [", ", el]))}
              .
            </p>
            <CopyCode label="install" code={INSTALL_SNIPPET} />
          </section>

          <section className={styles["referenceSection"]} aria-labelledby="hiw-local">
            <h2 id="hiw-local" className={styles["referenceSection__h"]}>
              Local machine
            </h2>
            <p className={styles["referenceSection__p"]}>
              No cloud account needed. The CLI installs the agent and dependencies directly on your computer.
            </p>
            <ol className={homeStyles["hoodSteps"]}>
              {localSteps.map((step, i) => (
                <li key={step.title} className={homeStyles["hoodStep"]}>
                  <span className={homeStyles["hoodStep__n"]}>{i + 1}</span>
                  <div>
                    <h3 className={homeStyles["hoodStep__h"]}>{step.title}</h3>
                    <p className={homeStyles["hoodStep__p"]}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles["referenceSection"]} aria-labelledby="hiw-cloud">
            <h2 id="hiw-cloud" className={styles["referenceSection__h"]}>
              Cloud environments
            </h2>
            <p className={styles["referenceSection__p"]}>
              On each launch, the CLI provisions a fresh VM in your cloud account (DigitalOcean, Hetzner, AWS, GCP, …)
              and installs the agent via cloud-init.
            </p>
            <ol className={homeStyles["hoodSteps"]}>
              {cloudSteps.map((step, i) => (
                <li key={step.title} className={homeStyles["hoodStep"]}>
                  <span className={homeStyles["hoodStep__n"]}>{i + 1}</span>
                  <div>
                    <h3 className={homeStyles["hoodStep__h"]}>{step.title}</h3>
                    <p className={homeStyles["hoodStep__p"]}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles["referenceSection__p"]}>
              Bootstrap scripts are served from the CDN at{" "}
              <code className={styles["inlineCode"]}>
                {AGENTSEA_PUBLIC_ORIGIN}/&lt;cloud&gt;/&lt;agent&gt;.sh
              </code>
              . The VM inherits <code className={styles["inlineCode"]}>THEGRID_API_KEY</code> and OpenAI-compatible
              base URLs targeting the Grid API.
            </p>
          </section>

          <section className={styles["referenceSection"]} aria-labelledby="hiw-post">
            <h2 id="hiw-post" className={styles["referenceSection__h"]}>
              After deploy
            </h2>
            <p className={styles["referenceSection__p"]}>
              Each agent is verified against The Grid on the target environment. See{" "}
              <a
                href="https://thegrid.ai/docs/integrations-and-best-practices/integrations"
                className={styles["fallback__link"]}
              >
                Grid integration docs
              </a>{" "}
              for agent-specific setup (OpenClaw, Hermes, Claude Code, Cursor IDE, …).
            </p>
            <ul className={homeStyles["hoodSteps"]}>
              <li>
                <code className={styles["inlineCode"]}>agentsea ls</code> — list deployments; use{" "}
                <strong>Open Dashboard</strong> for Hermes / OpenClaw UIs
              </li>
              <li>
                <code className={styles["inlineCode"]}>agentsea &lt;agent&gt; &lt;cloud&gt;</code> — provision a
                fresh environment with Grid credentials wired
              </li>
              <li>
                <code className={styles["inlineCode"]}>THEGRID_API_KEY</code> — consumption key from{" "}
                <a href="https://app.thegrid.ai" className={styles["fallback__link"]}>
                  app.thegrid.ai
                </a>
              </li>
            </ul>
          </section>
        </div>
      </main>

      <footer className={homeStyles["footer"]}>
        <p>
          <Link href={THE_GRID_EXTERNAL_URL} rel="noopener noreferrer" className={homeStyles["footer__link"]}>
            The Grid
          </Link>
        </p>
      </footer>
    </div>
  );
}
