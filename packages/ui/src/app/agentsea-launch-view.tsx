"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";

import type { NextStep } from "@agentsea/sdk";

import { CloudLogo, LocalMachineLogo } from "./cloud-logos";
import {
  AGENTSEA_INSTALL_URL,
  AGENTSEA_PUBLIC_ORIGIN,
  isAgentSeaCdnConfigured,
  THE_GRID_EXTERNAL_URL,
} from "./home-public-constants";
import { AgentseaCopyBlock } from "./agentsea-copy-block";
import styles from "./agentsea-launch-view.module.scss";

export type AgentseaLaunchViewProps = {
  agentSlug: string;
  agentName: string;
  agentImage: string | null;
  cloudSlug: string;
  cloudName: string;
  nextSteps?: NextStep[];
};

function NextStepItem({ step }: { step: NextStep }) {
  return (
    <li className={styles["nextStep"]}>
      <span className={styles["nextStep__text"]}>{step.text}</span>
      {step.link ? (
        <>
          {" "}
          <a href={step.link.url} rel="noopener noreferrer" className={styles["nextStep__link"]}>
            {step.link.label}
          </a>
        </>
      ) : null}
    </li>
  );
}

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

const ONE_COMMAND_INSTALL = (installUrl: string, agentSlug: string, cloudSlug: string) =>
  `curl -fsSL ${installUrl} | bash -s -- ${agentSlug} ${cloudSlug}`;

const INSTALL_ONLY_SNIPPET = (installUrl: string) => `curl -fsSL ${installUrl} | bash`;

const COMMON_COMMANDS_SNIPPET = `agentsea                              # Interactive picker
agentsea ls                            # List your deployments
agentsea matrix                        # Agent x cloud matrix`;

export const AgentseaLaunchView = memo(function AgentseaLaunchViewComp({
  agentSlug,
  agentName,
  agentImage,
  cloudSlug,
  cloudName,
  nextSteps,
}: AgentseaLaunchViewProps) {
  const oneCommand = ONE_COMMAND_INSTALL(AGENTSEA_INSTALL_URL, agentSlug, cloudSlug);
  const withoutCliSnippet = `bash <(curl -fsSL ${AGENTSEA_PUBLIC_ORIGIN}/${cloudSlug}/${agentSlug}.sh)`;

  return (
    <div className={styles["page"]}>
      <nav className={styles["topNav"]} aria-label="Launch flow">
        <Link href="/" className={styles["topNav__back"]}>
          &larr; Back to agent / cloud picker
        </Link>
      </nav>

      <section className={styles["hero"]} aria-labelledby="deploy-title">
        <h1 id="deploy-title" className={styles["hero__title"]}>
          Deploy {agentName} on {cloudName}
        </h1>
        <p className={styles["hero__lede"]}>
          Run {agentName} on {cloudName} with AgentSea — the easiest way to deploy Grid-backed AI agents on
          infrastructure you control. Copy the command below: it installs the CLI, then walks you through
          deployment interactively.
        </p>
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
              <span className={styles["pickCard__label"]}>Environment</span>
              <span className={styles["pickCard__name"]}>{cloudName}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles["band"]} aria-labelledby="step-run-title">
        <div className={styles["sectionHead"]}>
          <span className={styles["sectionHead__index"]} aria-hidden>
            1
          </span>
          <h2 id="step-run-title" className={styles["sectionHead__title"]}>
            Run this command
          </h2>
        </div>

        <p className={styles["stepLead"]}>
          Paste this in your terminal (macOS, Linux, or WSL). It installs AgentSea, then starts{" "}
          <code className={styles["inlineCode"]}>agentsea {agentSlug} {cloudSlug}</code> and guides you through
          the rest — API keys, provisioning, and connecting to your agent.
        </p>

        <AgentseaCopyBlock code={oneCommand} prominent />

        <details className={styles["details"]}>
          <summary className={styles["details__summary"]}>Already installed? Run deploy only</summary>
          <div className={styles["details__body"]}>
            <AgentseaCopyBlock code={`agentsea ${agentSlug} ${cloudSlug}`} />
          </div>
        </details>

        <details className={styles["details"]}>
          <summary className={styles["details__summary"]}>Install CLI without deploying</summary>
          <div className={styles["details__body"]}>
            <AgentseaCopyBlock code={INSTALL_ONLY_SNIPPET(AGENTSEA_INSTALL_URL)} />
          </div>
        </details>

        <p className={styles["stepFoot"]}>
          Install options and flags in the{" "}
          <Link href="/cli" className={styles["stepFoot__link"]}>
            CLI Reference
          </Link>
          .
        </p>

        <details className={styles["details"]}>
          <summary className={styles["details__summary"]}>Common commands</summary>
          <div className={styles["details__body"]}>
            <AgentseaCopyBlock code={COMMON_COMMANDS_SNIPPET} />
          </div>
        </details>
      </section>

      {nextSteps && nextSteps.length > 0 ? (
        <section className={styles["band"]} aria-labelledby="after-install-title">
          <div className={styles["sectionHead"]}>
            <span className={styles["sectionHead__index"]} aria-hidden>
              2
            </span>
            <h2 id="after-install-title" className={styles["sectionHead__title"]}>
              After install — what to do next
            </h2>
          </div>
          <p className={styles["stepLead"]}>
            Once AgentSea finishes provisioning <strong>{agentName}</strong> on{" "}
            <strong>{cloudName}</strong>, here&apos;s how to get the most from your agent.
          </p>
          <ul className={styles["nextSteps"]}>
            {nextSteps.map((step, index) => (
              <NextStepItem key={`${index}-${step.text.slice(0, 24)}`} step={step} />
            ))}
          </ul>
        </section>
      ) : null}

      {isAgentSeaCdnConfigured && (
        <section className={styles["band"]} aria-labelledby="without-cli-title">
          <h2 id="without-cli-title" className={styles["altTitle"]}>
            Prefer not to install the CLI?
          </h2>
          <p className={styles["stepLead"]}>
            Run this one-liner instead — no global install required. It downloads and runs the bootstrap script
            for <strong>{agentName}</strong> on <strong>{cloudName}</strong>.
          </p>
          <AgentseaCopyBlock code={withoutCliSnippet} />
        </section>
      )}

      <p className={styles["agentseaFoot"]}>
        <Link href="/" className={styles["agentseaFoot__link"]}>
          &larr; Pick another agent
        </Link>
        {" | "}
        <Link href={`/?agent=${encodeURIComponent(agentSlug)}`} className={styles["agentseaFoot__link"]}>
          Change environment
        </Link>
      </p>

      <footer className={styles["footer"]}>
        <a href={THE_GRID_EXTERNAL_URL} rel="noopener noreferrer" className={styles["footer__link"]}>
          The Grid
        </a>
      </footer>
    </div>
  );
});
