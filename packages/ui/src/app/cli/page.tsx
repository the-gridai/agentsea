import Link from "next/link";
import type { Metadata } from "next";

import { CopyCode } from "../copy-code";
import { GRID_SPAWN_INSTALL_URL, THEGRID_API_KEY_ENV_VAR } from "../home-public-constants";
import { SiteHeader } from "../site-header";
import styles from "./page.module.scss";

export const metadata: Metadata = {
  title: "CLI guide — Grid Spawn",
  description:
    "Install Grid Spawn, set your The Grid API key and DigitalOcean token, and launch OpenClaw from the terminal.",
};

const INSTALL_SH = `curl -fsSL ${GRID_SPAWN_INSTALL_URL} | bash`;

export default function CliGuidePage() {
  return (
    <div className={styles["page"]}>
      <SiteHeader />
      <main className={styles["main"]}>
        <article className={styles["wrap"]}>
          <h1 className={styles["title"]}>CLI guide</h1>
          <p className={styles["intro"]}>
            Install the CLI once, set <code>{THEGRID_API_KEY_ENV_VAR}</code> (your The Grid platform API key), add your
            cloud token, then run an interactive launcher or short one-liners. The Grid Spawn control plane provisions
            your VM and returns a URL for the in-browser terminal.
          </p>

          <p className={styles["note"]}>
            <strong>Status:</strong> the CLI is not published yet. Use this page as the contract for the first release
            (install paths, env vars, and command names may change slightly until 0.1); the install script and binary
            will ship together.
          </p>

          <section className={styles["section"]} aria-labelledby="install">
            <h2 id="install">Install</h2>
            <p>Recommended: install script (macOS, Linux, WSL).</p>
            <CopyCode label="install" code={INSTALL_SH} />
            <p>Or install from npm when the package is released:</p>
            <CopyCode label="shell" code="npm install -g @grid-spawn/cli" />
          </section>

          <section className={styles["section"]} aria-labelledby="auth">
            <h2 id="auth">Authenticate with The Grid</h2>
            <p>
              Create an API key in the Grid dashboard (used for provisioning and agent inference). For scripts and CI,
              CI, export it before you run the CLI:
            </p>
            <CopyCode label="shell" code={`export ${THEGRID_API_KEY_ENV_VAR}="…your key…"`} />
            <p>
              If <code>{THEGRID_API_KEY_ENV_VAR}</code> is not set, the CLI prompts once and can save the key under{" "}
              <code>~/.config/grid-spawn</code> (exact path printed on first run). <code>grid-spawn login</code> does
              the same interactively; <code>grid-spawn logout</code> removes the saved key. Non-interactive jobs should
              always use the environment variable.
            </p>
            <CopyCode label="shell" code="grid-spawn login" />
          </section>

          <section className={styles["section"]} aria-labelledby="cloud">
            <h2 id="cloud">Connect DigitalOcean</h2>
            <p>Export a personal access token with permission to create droplets in your team.</p>
            <CopyCode label="shell" code='export DIGITALOCEAN_TOKEN="dop_v1_..."' />
          </section>

          <section className={styles["section"]} aria-labelledby="commands">
            <h2 id="commands">Command reference</h2>
            <p>Common entrypoints (names align with the shipped CLI; flags may expand in 0.1).</p>

            <div className={styles["tableWrap"]}>
              <table className={styles["table"]}>
                <thead>
                  <tr>
                    <th scope="col">Command</th>
                    <th scope="col">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>grid-spawn</code>
                    </td>
                    <td>Interactive picker — agent, region, size, workspace.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>grid-spawn openclaw digitalocean …</code>
                    </td>
                    <td>
                      Direct launch (OpenClaw on DigitalOcean); supports <code>--region</code>, <code>--size</code>,
                      etc.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>grid-spawn ls</code>
                    </td>
                    <td>List spawns in the active workspace.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>grid-spawn terminal &lt;spawn-id&gt;</code>
                    </td>
                    <td>Print (and open) the browser terminal URL for a spawn.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>grid-spawn destroy &lt;spawn-id&gt;</code>
                    </td>
                    <td>Terminate VM and revoke API credentials for that spawn.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>grid-spawn login</code> / <code>logout</code>
                    </td>
                    <td>Save or clear the The Grid API key in the CLI config (optional if you use env vars).</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className={styles["compactP"]}>
              <strong>Examples</strong>
            </p>
            <CopyCode
              label="shell"
              code={`export ${THEGRID_API_KEY_ENV_VAR}="…"
export DIGITALOCEAN_TOKEN="dop_v1_…"
grid-spawn openclaw digitalocean --region nyc3
grid-spawn ls
grid-spawn terminal sp_abc123`}
            />
          </section>

          <section className={styles["section"]} aria-labelledby="env">
            <h2 id="env">Environment variables</h2>
            <div className={styles["tableWrap"]}>
              <table className={styles["table"]}>
                <thead>
                  <tr>
                    <th scope="col">Variable</th>
                    <th scope="col">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>{THEGRID_API_KEY_ENV_VAR}</code>
                    </td>
                    <td>
                      Your The Grid platform API key — required for provisioning and inference billing (Bearer on
                      control plane requests).
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>GRID_SPAWN_API</code>
                    </td>
                    <td>Control plane base URL (defaults to production when shipped).</td>
                  </tr>
                  <tr>
                    <td>
                      <code>GRID_API_BASE_URL</code>
                    </td>
                    <td>
                      Grid API origin for chat/completions and key management (defaults to production when unset).
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>DIGITALOCEAN_TOKEN</code>
                    </td>
                    <td>DigitalOcean personal access token for provisioning.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles["section"]} aria-labelledby="troubleshooting">
            <h2 id="troubleshooting">Troubleshooting</h2>
            <ul className={styles["troubleList"]}>
              <li>
                <strong>Command not found after install</strong> — Ensure <code>~/.local/bin</code> (or the install path
                printed by the script) is on your <code>PATH</code>. Open a new shell or run <code>exec $SHELL</code>.
              </li>
              <li>
                <strong>401 / auth failures</strong> — Confirm <code>{THEGRID_API_KEY_ENV_VAR}</code> is set (or run{" "}
                <code>grid-spawn login</code>). If you rotate keys in the dashboard, update the env var or re-run login.
                Check <code>GRID_API_BASE_URL</code> when using a non-default Grid stack.
              </li>
              <li>
                <strong>Cloud API errors</strong> — Verify <code>DIGITALOCEAN_TOKEN</code> scopes (droplet create) and
                account billing. Try another region if capacity is exhausted.
              </li>
              <li>
                <strong>Wrong control plane</strong> — Set <code>GRID_SPAWN_API</code> explicitly for staging or
                self-hosted planes.
              </li>
            </ul>
          </section>

          <p className={styles["footer"]}>
            <Link href="/">← Back to overview</Link>
          </p>
        </article>
      </main>
    </div>
  );
}
