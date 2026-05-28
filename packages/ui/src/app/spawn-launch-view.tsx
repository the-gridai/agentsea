"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";

import { CloudLogo, LocalMachineLogo } from "./cloud-logos";
import {
  GRID_SPAWN_INSTALL_URL,
  GRID_SPAWN_PUBLIC_ORIGIN,
  THE_GRID_EXTERNAL_URL,
} from "./home-public-constants";
import { SpawnCopyBlock } from "./spawn-copy-block";
import { WHY_GRID_SPAWN_CARDS } from "./why-grid-spawn-cards";
import styles from "./spawn-launch-view.module.scss";

export type SpawnLaunchViewProps = {
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

function buildSpawnSnippet(agentSlug: string, cloudSlug: string): string {
  return `# Install Grid Spawn
curl -fsSL ${GRID_SPAWN_INSTALL_URL} | bash

# Launch
grid-spawn ${agentSlug} ${cloudSlug}`;
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
        body: "Prompts for your The Grid API key and saves it under ~/.config/grid-spawn/ when you confirm.",
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

export const SpawnLaunchView = memo(function SpawnLaunchViewComp({
  agentSlug,
  agentName,
  agentImage,
  cloudSlug,
  cloudName,
}: SpawnLaunchViewProps) {
  const spawnSnippet = buildSpawnSnippet(agentSlug, cloudSlug);
  const steps = hoodSteps(cloudSlug);

  const withoutCliSnippet = `bash <(curl -fsSL ${GRID_SPAWN_PUBLIC_ORIGIN}/${cloudSlug}/${agentSlug}.sh)`;

  const cliRefSnippet = `grid-spawn                              # Interactive picker
grid-spawn ls                            # List your spawns
grid-spawn matrix                        # Agent x cloud matrix`;

  return (
    <div className={styles["page"]}>
      <nav className={styles["topNav"]} aria-label="Launch flow">
        <Link href="/" className={styles["topNav__back"]}>
          &larr; Back to agent / cloud picker
        </Link>
      </nav>

      <section className={styles["hero"]} aria-labelledby="spawn-title">
        <h1 id="spawn-title" className={styles["hero__title"]}>
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

      <section className={styles["band"]} aria-labelledby="spawn-step-title">
        <div className={styles["sectionHead"]}>
          <span className={styles["sectionHead__index"]} aria-hidden>
            3
          </span>
          <h2 id="spawn-step-title" className={styles["sectionHead__title"]}>
            Spawn
          </h2>
        </div>

        <SpawnCopyBlock code={spawnSnippet} />

        <p className={styles["spawnFoot"]}>
          <Link href="/" className={styles["spawnFoot__link"]}>
            &larr; Pick another agent
          </Link>
          {" | "}
          <Link href={`/?agent=${encodeURIComponent(agentSlug)}`} className={styles["spawnFoot__link"]}>
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
              <SpawnCopyBlock code={cliRefSnippet} />
            </div>
            <div className={styles["hoodCodeCard"]}>
              <h3 className={styles["hoodCodeCard__title"]}>Without the CLI</h3>
              <SpawnCopyBlock code={withoutCliSnippet} />
            </div>
          </div>
        </div>
      </section>

      <section className={styles["band"]} aria-labelledby="why-title">
        <h2 id="why-title" className={styles["bandTitle"]}>
          Why Grid Spawn?
        </h2>
        <div className={styles["whyGrid"]}>
          {WHY_GRID_SPAWN_CARDS.slice(0, 2).map((c) => (
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
