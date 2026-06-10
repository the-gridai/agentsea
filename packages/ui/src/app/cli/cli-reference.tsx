import Link from "next/link";

import { CopyCode } from "../copy-code";
import {
  DIGITALOCEAN_ACCESS_TOKEN_ENV_VAR,
  AGENTSEA_INSTALL_URL,
  AGENTSEA_REQUEST_AGENT_MAILTO,
  THEGRID_API_KEY_ENV_VAR,
  THEGRID_API_KEYS_DASHBOARD_ORIGIN,
} from "../home-public-constants";

import styles from "./page.module.scss";

const INSTALL_SNIPPET = `curl -fsSL ${AGENTSEA_INSTALL_URL} | bash`;

const INSTALL_AND_LAUNCH_SNIPPET = (agent: string, cloud: string) =>
  `curl -fsSL ${AGENTSEA_INSTALL_URL} | bash -s -- ${agent} ${cloud}`;

const COMMON_COMMANDS_SNIPPET = `agentsea                                # Interactive picker
agentsea <agent> <cloud>                # Launch directly (e.g. openclaw digitalocean)
agentsea ls                             # List your deployments
agentsea matrix                         # Agent x cloud support matrix
agentsea --help                         # Full flag reference`;

const ENV_SNIPPET = `# Grid platform (required for inference + dashboard)
export ${THEGRID_API_KEY_ENV_VAR}=...     # create at ${THEGRID_API_KEYS_DASHBOARD_ORIGIN}

# Per-cloud tokens (only the one you launch into)
export ${DIGITALOCEAN_ACCESS_TOKEN_ENV_VAR}=...
export HCLOUD_TOKEN=...                   # Hetzner
# (AWS / GCP follow their SDK conventions)`;

/**
 * Real reference content for `/cli` when no agent+cloud is selected.
 * Previously this fallback was a one-line "Pick an agent and provider" stub,
 * which made the "CLI guide" link in the header land on something that
 * looked broken instead of a guide. Header link points here; the
 * homepage's launch flow deep-links to `/{agent}/{cloud}` launch pages.
 */
export function CliReference({ agentSlug, agentName }: { agentSlug?: string; agentName?: string }) {
  return (
    <div className={styles["reference"]}>
      <header className={styles["referenceHero"]}>
        <h1 className={styles["referenceHero__title"]}>CLI Reference</h1>
        <p className={styles["referenceHero__p"]}>
          {agentSlug && agentName ? (
            <>
              Reference for the <code className={styles["inlineCode"]}>agentsea</code> CLI. Pick a cloud for{" "}
              <strong>{agentName}</strong> on the{" "}
              <Link href={`/?agent=${encodeURIComponent(agentSlug)}`} className={styles["fallback__link"]}>
                homepage
              </Link>{" "}
              to get a tailored install + launch snippet.
            </>
          ) : (
            <>
              Reference for the <code className={styles["inlineCode"]}>agentsea</code> CLI. To get a launch-ready
              install + run snippet, pick an agent and a cloud on the{" "}
              <Link href="/" className={styles["fallback__link"]}>
                homepage
              </Link>
              .
            </>
          )}
        </p>
      </header>

      <section className={styles["referenceSection"]} aria-labelledby="ref-install">
        <h2 id="ref-install" className={styles["referenceSection__h"]}>
          Install
        </h2>
        <p className={styles["referenceSection__p"]}>
          One curl pipe. Works on macOS, Linux, and WSL — installs to <code className={styles["inlineCode"]}>~/.local/bin</code>{" "}
          and adds it to <code className={styles["inlineCode"]}>PATH</code> for new shells. Pass agent and cloud to
          install and start deployment in one step:
        </p>
        {agentSlug ? (
          <CopyCode
            label="install and deploy"
            code={INSTALL_AND_LAUNCH_SNIPPET(agentSlug, "digitalocean")}
          />
        ) : (
          <CopyCode
            label="install and deploy (example)"
            code={INSTALL_AND_LAUNCH_SNIPPET("openclaw", "digitalocean")}
          />
        )}
        <p className={styles["referenceSection__p"]}>CLI only (no auto-launch):</p>
        <CopyCode label="install only" code={INSTALL_SNIPPET} />
      </section>

      <section className={styles["referenceSection"]} aria-labelledby="ref-commands">
        <h2 id="ref-commands" className={styles["referenceSection__h"]}>
          Common commands
        </h2>
        <CopyCode code={COMMON_COMMANDS_SNIPPET} />
      </section>

      <section className={styles["referenceSection"]} aria-labelledby="ref-env">
        <h2 id="ref-env" className={styles["referenceSection__h"]}>
          Environment variables
        </h2>
        <p className={styles["referenceSection__p"]}>
          <code className={styles["inlineCode"]}>agentsea</code> reads from your shell, then from{" "}
          <code className={styles["inlineCode"]}>.env</code> at the repo root, then from saved config under{" "}
          <code className={styles["inlineCode"]}>~/.config/agentsea/</code>.
        </p>
        <CopyCode label="env" code={ENV_SNIPPET} />
      </section>

      <section className={styles["referenceSection"]} aria-labelledby="ref-missing">
        <h2 id="ref-missing" className={styles["referenceSection__h"]}>
          Missing something?
        </h2>
        <p className={styles["referenceSection__p"]}>
          Run <code className={styles["inlineCode"]}>agentsea --help</code> for the full flag reference, or{" "}
          <a href={AGENTSEA_REQUEST_AGENT_MAILTO} className={styles["fallback__link"]}>
            request a missing agent
          </a>
          .
        </p>
      </section>
    </div>
  );
}
