"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";

import { CloudLogo, LocalMachineLogo } from "./cloud-logos";
import {
  AGENTSEA_INSTALL_URL,
  AGENTSEA_PUBLIC_ORIGIN,
  THE_GRID_EXTERNAL_URL,
} from "./home-public-constants";
import { AgentseaCopyBlock } from "./agentsea-copy-block";
import { WHY_AGENTSEA_CARDS } from "./why-agentsea-cards";
import styles from "./agentsea-launch-view.module.scss";

export type AgentseaLaunchViewProps = {
  agentSlug: string;
  agentName: string;
  agentImage: string | null;
  cloudSlug: string;
  cloudName: string;
};

function cloudSummaryLogo(cloudSlug: string) {
  return (
    <CloudLogo
      slug={cloudSlug}
      size={40}
      imgClassName={styles["pickCard__img"]}
      svgClassName={styles["pickCard__logoSvg"]}
    />
  );
}

function buildAgentseaSnippet(agentSlug: string, cloudSlug: string): string {
  return `# Install AgentSea
curl -fsSL ${AGENTSEA_INSTALL_URL} | bash

# Launch
agentsea ${agentSlug} ${cloudSlug}`;
}

function hoodSteps(cloudSlug: string) {
  if (cloudSlug === "local") {
    return [
      {
        title: "Install",
        body: "Installs the agent and dependencies on this machine. No cloud account needed.",
      },
      {
        title: "Authenticate",
        body: "Prompts for your The Grid API key and saves it under ~/.config/agentsea/ when you confirm.",
      },
      {
        title: "Configure",
        body: "Wires environment variables, Grid API endpoints, and model routing.",
      },
      {
        title: "Connect",
        body: "Launches the agent in your terminal with full TTY support.",
      },
    ];
  }

  return [
    {
      title: "Provision",
      body: "Spins up a fresh VM in your cloud account. No Terraform or YAML configs.",
    },
    {
      title: "Install",
      body: "Cloud-init installs the agent and dependencies on the new server.",
    },
    {
      title: "Authenticate",
      body: "Injects your The Grid API key and cloud credentials into the VM.",
    },
    {
      title: "Configure",
      body: "Sets environment, OpenAI-compatible endpoints, and model routing to The Grid.",
    },
    {
      title: "Connect",
      body: "Opens an SSH session. Drive the interactive agent from your terminal.",
    },
  ];
}

export const AgentseaLaunchView = memo(function AgentseaLaunchViewComp({
  agentSlug,
  agentName,
  agentImage,
  cloudSlug,
  cloudName,
}: AgentseaLaunchViewProps) {
  const agentseaSnippet = buildAgentseaSnippet(agentSlug, cloudSlug);
  const steps = hoodSteps(cloudSlug);

  const withoutCliSnippet = `bash <(curl -fsSL ${AGENTSEA_PUBLIC_ORIGIN}/${cloudSlug}/${agentSlug}.sh)`;

  const cliRefSnippet = `agentsea                              # Interactive picker
agentsea ls                            # List your deployments
agentsea matrix                        # Agent x cloud matrix`;

  return (
    <div className={styles["page"]}>
      <nav className={styles["topNav"]} aria-label="Launch flow">
        <Link href="/" className={styles["topNav__back"]}>
          &larr; Back to agent / cloud picker
        </Link>
      </nav>

      <section className={styles["hero"]} aria-labelledby="agentsea-title">
        <h1 id="agentsea-title" className={styles["hero__title"]}>
          Launch {agentName} on {cloudName}
        </h1>
        <div className={styles["pickRow"]}>
          <div className={styles["pickCard"]}>
            <div className={styles["pickCard__logo"]} aria-hidden>
              {agentImage ? (
                <Image
                  src={`/agents/${agentImage}`}
                  alt=""
                  width={40}
                  height={40}
                  className={styles["pickCard__img"]}
                />
              ) : (
                <LocalMachineLogo className={styles["pickCard__logoSvg"]} />
              )}
            </div>
            <div className={styles["pickCard__body"]}>
              <span className={styles["pickCard__label"]}>Agent</span>
              <span className={styles["pickCard__name"]}>{agentName}</span>
            </div>
          </div>

          <span className={styles["pickRow__on"]} aria-hidden>
            on
          </span>

          <div className={styles["pickCard"]}>
            <div className={styles["pickCard__logo"]} aria-hidden>
              {cloudSummaryLogo(cloudSlug)}
            </div>
            <div className={styles["pickCard__body"]}>
              <span className={styles["pickCard__label"]}>Cloud</span>
              <span className={styles["pickCard__name"]}>{cloudName}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles["band"]} aria-labelledby="agentsea-step-title">
        <div className={styles["sectionHead"]}>
          <span className={styles["sectionHead__index"]} aria-hidden>
            3
          </span>
          <h2 id="agentsea-step-title" className={styles["sectionHead__title"]}>
            Launch
          </h2>
        </div>

        <AgentseaCopyBlock code={agentseaSnippet} />

        <p className={styles["agentseaFoot"]}>
          <Link href="/" className={styles["agentseaFoot__link"]}>
            &larr; Pick another agent
          </Link>
          {" | "}
          <Link href={`/?agent=${encodeURIComponent(agentSlug)}`} className={styles["agentseaFoot__link"]}>
            Change provider
          </Link>
        </p>
      </section>

      <section className={styles["band"]} aria-labelledby="hood-title">
        <h2 id="hood-title" className={styles["bandTitle"]}>
          Under the Hood
        </h2>

        <ol className={styles["hoodSteps"]}>
          {steps.map((step, i) => (
            <li key={step.title} className={styles["hoodStep"]}>
              <span className={styles["hoodStep__n"]}>{i + 1}</span>
              <div className={styles["hoodStep__body"]}>
                <h3 className={styles["hoodStep__h"]}>{step.title}</h3>
                <p className={styles["hoodStep__p"]}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles["hoodCodeSection"]}>
          <div className={styles["hoodCodeGrid"]}>
            <div className={styles["hoodCodeCard"]}>
              <h3 className={styles["hoodCodeCard__title"]}>CLI reference</h3>
              <AgentseaCopyBlock code={cliRefSnippet} stretch />
            </div>
            <div className={styles["hoodCodeCard"]}>
              <h3 className={styles["hoodCodeCard__title"]}>Without the CLI</h3>
              <AgentseaCopyBlock code={withoutCliSnippet} stretch />
            </div>
          </div>
        </div>
      </section>

      <section className={styles["band"]} aria-labelledby="why-title">
        <h2 id="why-title" className={styles["bandTitle"]}>
          Why AgentSea?
        </h2>
        <div className={styles["whyGrid"]}>
          {WHY_AGENTSEA_CARDS.slice(0, 2).map((c) => (
            <div key={c.title} className={styles["whyCard"]}>
              <h3 className={styles["whyCard__h"]}>{c.title}</h3>
              <p className={styles["whyCard__p"]}>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles["footer"]}>
        <a href={THE_GRID_EXTERNAL_URL} rel="noopener noreferrer" className={styles["footer__link"]}>
          The Grid
        </a>
      </footer>
    </div>
  );
});
