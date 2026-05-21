import Link from "next/link";
import { Suspense } from "react";

import { CopyCode } from "./copy-code";
import { HomeLaunchFlow } from "./home-launch-flow";
import {
  GRID_SPAWN_INSTALL_URL,
  GRID_SPAWN_OPENCLAW_DO_ONELINER,
  isGridSpawnCdnConfigured,
  THE_GRID_EXTERNAL_URL,
} from "./home-public-constants";
import { homeAgentCloudAvailability, homeAgentsFromManifest, homeCloudOptionsFromManifest } from "./landing-from-manifest";
import { SiteHeader } from "./site-header";
import { SpawnCopyBlock } from "./spawn-copy-block";
import styles from "./page.module.scss";

import { loadManifest } from "@grid-spawn/sdk/node";
const CLI_SNIPPET = `# With grid-spawn on your PATH, try:
grid-spawn                              # Interactive picker
grid-spawn openclaw digitalocean         # Launch directly
grid-spawn ls                            # List your spawns`;

const CURL_PIPE_SNIPPET = `bash <(curl -fsSL ${GRID_SPAWN_INSTALL_URL})`;

const INSTALL_SNIPPET = `curl -fsSL ${GRID_SPAWN_INSTALL_URL} | bash`;

const WITHOUT_CLI_SNIPPET = `bash <(curl -fsSL ${GRID_SPAWN_OPENCLAW_DO_ONELINER})`;

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
              Spawn AI agents locally or on the cloud
            </h1>
            <p className={styles["hero__tagline"]}>
              Any agent, on your infrastructure — wired to The Grid API.
            </p>
          </section>

          <Suspense fallback={null}>
            <HomeLaunchFlow
              agents={agents}
              cloudOptions={cloudOptions}
              agentCloudAvailability={agentCloudAvailability}
            />
          </Suspense>
          {isGridSpawnCdnConfigured && (
            <section className={styles["band"]} aria-labelledby="without-cli-title">
              <h2 id="without-cli-title" className={styles["h2"]}>
                Without the CLI
              </h2>
              <p className={styles["lede"]}>One curl command. No global install.</p>
              <div className={styles["withoutCliCopy"]}>
                <SpawnCopyBlock code={WITHOUT_CLI_SNIPPET} />
              </div>
            </section>
          )}

          <section className={styles["band"]} aria-labelledby="hood-title">
            <h2 id="hood-title" className={styles["h2"]}>
              Under the Hood
            </h2>
            <p className={styles["lede"]}>
              There are two layers: <strong>your laptop</strong> (install the CLI once), then{" "}
              <strong>your cloud</strong>.
            </p>

            <div className={styles["hoodInstallCard"]}>
              <p className={styles["hoodInstallCard__kicker"]}>Do this first — one time on your computer</p>
              <h3 className={styles["hoodInstallCard__title"]}>
                Install the <code className={styles["hoodInstallCard__code"]}>grid-spawn</code> CLI
              </h3>
              <p className={styles["hoodInstallCard__hint"]}>
                Paste into a terminal (macOS, Linux, or WSL). When it finishes, the{" "}
                <code className={styles["hoodInstallCard__code"]}>grid-spawn</code> command should work. Everything
                below assumes this step is done.
              </p>
              <CopyCode label="install" code={INSTALL_SNIPPET} />
              <p className={styles["hoodInstallCard__alt"]}>
                Same script via process substitution:{" "}
                <code className={styles["hoodInstallCard__inline"]}>{CURL_PIPE_SNIPPET}</code> · npm, env vars, and auth
                in the{" "}
                <Link href="/cli" className={styles["inlineLink"]}>
                  CLI guide
                </Link>
                .
              </p>
            </div>

            <p className={styles["hoodPipelineLead"]}>
              <strong>On each spawn</strong>, the CLI provisions your cloud VM and installs the agent.
            </p>
            <ol className={styles["hoodSteps"]}>
              <li className={styles["hoodStep"]}>
                <span className={styles["hoodStep__n"]}>1</span>
                <div>
                  <h3 className={styles["hoodStep__h"]}>Provision</h3>
                  <p className={styles["hoodStep__p"]}>
                    Authenticate to your cloud (DigitalOcean, Hetzner, AWS, GCP, …) via environment variables or saved
                    config under <code>~/.config/grid-spawn/</code>.
                  </p>
                </div>
              </li>
              <li className={styles["hoodStep"]}>
                <span className={styles["hoodStep__n"]}>2</span>
                <div>
                  <h3 className={styles["hoodStep__h"]}>Bootstrap</h3>
                  <p className={styles["hoodStep__p"]}>
                    Cloud-init pulls the bootstrap script (<code>/sh/&lt;cloud&gt;/&lt;agent&gt;.sh</code>) referenced
                    in the CDN URL pattern below.
                  </p>
                </div>
              </li>
              <li className={styles["hoodStep"]}>
                <span className={styles["hoodStep__n"]}>3</span>
                <div>
                  <h3 className={styles["hoodStep__h"]}>Wire The Grid</h3>
                  <p className={styles["hoodStep__p"]}>
                    The VM inherits <code>THEGRID_API_KEY</code> and OpenAI-compatible base URLs targeting the Grid API —
                    billing stays on-platform.
                  </p>
                </div>
              </li>
              <li className={styles["hoodStep"]}>
                <span className={styles["hoodStep__n"]}>4</span>
                <div>
                  <h3 className={styles["hoodStep__h"]}>Run over SSH</h3>
                  <p className={styles["hoodStep__p"]}>
                    The CLI hands you an SSH session — you drive the interactive agent (TTY) locally with full terminal
                    support.
                  </p>
                </div>
              </li>
            </ol>

            <h3 className={styles["hoodCommandsTitle"]} id="hood-commands">
              Then use the CLI
            </h3>
            <p className={styles["hoodCommandsSub"]}>After the installer completes, run commands like:</p>
            <div className={styles["hoodCommandsBlock"]}>
              <CopyCode code={CLI_SNIPPET} />
            </div>
          </section>

          <section className={styles["band"]} aria-labelledby="why-title">
            <h2 id="why-title" className={styles["h2"]}>
              Why Grid Spawn?
            </h2>
            <p className={styles["lede"]}>
              The fastest way to deploy Grid-backed agents on infrastructure you control.
            </p>
            <div className={styles["whyGrid"]}>
              <div className={styles["whyCard"]}>
                <h3 className={styles["whyCard__h"]}>Agent-agnostic</h3>
                <p className={styles["whyCard__p"]}>
                  Start with OpenClaw, Codex, or OpenCode, then add more agents as they become available.
                </p>
              </div>
              <div className={styles["whyCard"]}>
                <h3 className={styles["whyCard__h"]}>Bring your own cloud</h3>
                <p className={styles["whyCard__p"]}>
                  Your provider account, your keys — we orchestrate, you own the bill and the data plane.
                </p>
              </div>
              <div className={styles["whyCard"]}>
                <h3 className={styles["whyCard__h"]}>Fully sandboxed</h3>
                <p className={styles["whyCard__p"]}>
                  Each spawn is an isolated VM and credential boundary — no cross-talk between sessions.
                </p>
              </div>
              <div className={styles["whyCard"]}>
                <h3 className={styles["whyCard__h"]}>The Grid inference</h3>
                <p className={styles["whyCard__p"]}>
                  Inference routes through the Grid API (OpenAI-compatible) — budgets, keys, and usage on-platform.
                </p>
              </div>
            </div>
          </section>

          <section className={styles["band"]} aria-labelledby="install-title">
            <h2 id="install-title" className={styles["h2"]}>
              CLI reference
            </h2>
            <p className={styles["lede"]}>
              The Grid API key, DigitalOcean tokens, environment variables, and every flag — documented in the{" "}
              <Link href="/cli" className={styles["inlineLink"]}>
                CLI guide
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className={styles["footer"]}>
        <p>
          <Link href="/cli" className={styles["footer__link"]}>
            CLI reference
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
