import type { VMConnection } from "../history.js";
import type { Manifest } from "../manifest.js";
import type { SshTunnelHandle } from "../shared/ssh.js";

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  validateConnectionIP,
  validateLaunchCmd,
  validatePreLaunchCmd,
  validateServerIdentifier,
  validateTunnelPort,
  validateTunnelUrl,
  validateUsername,
} from "../security.js";
import { getHistoryPath } from "../shared/paths.js";
import { asyncTryCatchIf, isOperationalError, tryCatch } from "../shared/result.js";
import { SSH_BASE_OPTS, SSH_INTERACTIVE_OPTS, agentseaInteractive, startSshTunnel } from "../shared/ssh.js";
import { ensureSshKeys, getSshKeyOpts } from "../shared/ssh-keys.js";
import { AGENTSEA_CLI } from "../shared/cli-invocation.js";
import {
  issueT3PairingBrowserUrl,
  logT3PairingHandoff,
  rewriteT3RemotePairingUrl,
  startT3PairingBrowserWatcher,
  T3_REMOTE_PORT,
} from "../shared/t3-config.js";
import { buildHermesDashboardStartScript } from "../shared/hermes-dashboard.js";
import { logError, logWarn, openBrowser, rewriteLocalhostHttpUrlForWindowsBrowserFromWsl, shellQuote } from "../shared/ui.js";
import { getErrorMessage } from "./shared.js";

/** Strip persisted tunnel template down to path?query (Daytona preview host is prepended). */
function tunnelTemplateToUrlSuffix(template: string): string {
  return template
    .replace(/^http:\/\/localhost:__PORT__/, "")
    .replace(/^http:\/\/127\.0\.0\.1:__PORT__/, "");
}

async function openAgentTunnelBrowser(
  agentKey: string,
  connection: VMConnection,
  localPort: number,
  urlTemplate?: string,
): Promise<void> {
  if (agentKey === "t3code") {
    const keys = await ensureSshKeys();
    const pairingUrl = await issueT3PairingBrowserUrl(
      connection.ip,
      connection.user,
      getSshKeyOpts(keys),
      localPort,
    );
    if (pairingUrl) {
      openBrowser(pairingUrl);
      logT3PairingHandoff(localPort, pairingUrl);
      return;
    }
    if (urlTemplate) {
      const fallback = rewriteT3RemotePairingUrl(
        urlTemplate.replace("__PORT__", String(T3_REMOTE_PORT)),
        localPort,
      );
      if (fallback) {
        openBrowser(fallback);
        logT3PairingHandoff(localPort, fallback);
        return;
      }
    }
    logT3PairingHandoff(localPort);
    return;
  }
  if (urlTemplate) {
    const url = urlTemplate.replace("__PORT__", String(localPort));
    openBrowser(url);
  }
}

/**
 * Check the remote VM for security alerts written by the agentsea-security-scan cron.
 * If alerts exist, display them as warnings before launching the agent.
 * Silently skips if the alerts file doesn't exist (scan not installed) or SSH fails.
 */
async function checkSecurityAlerts(ip: string, user: string, keyOpts: string[]): Promise<void> {
  const result = await asyncTryCatchIf(isOperationalError, async () => {
    const proc = Bun.spawn(
      [
        "ssh",
        ...SSH_BASE_OPTS,
        ...keyOpts,
        `${user}@${ip}`,
        "--",
        "cat /var/log/agentsea-security-alerts.log 2>/dev/null || true",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const trimmed = output.trim();
    if (!trimmed) {
      return;
    }
    // Display each alert line as a warning
    process.stderr.write("\n");
    p.log.warn(pc.bold(pc.yellow("Security alerts from your VM:")));
    for (const line of trimmed.split("\n")) {
      // Strip the timestamp prefix for cleaner display
      const stripped = line.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\]\s*/, "");
      if (stripped) {
        p.log.warn(`  ${stripped}`);
      }
    }
    process.stderr.write("\n");
  });
  if (!result.ok) {
    // Silently ignore — security check is best-effort
  }
}

/** Execute a shell command and resolve/reject on process close/error */
async function runInteractiveCommand(
  cmd: string,
  args: string[],
  failureMsg: string,
  manualCmd: string,
): Promise<void> {
  const r = tryCatch(() =>
    agentseaInteractive([
      cmd,
      ...args,
    ]),
  );
  if (!r.ok) {
    logError(`Failed to connect: ${getErrorMessage(r.error)}`);
    p.log.info(`Try manually: ${pc.cyan(manualCmd)}`);
    throw r.error;
  }
  const code = r.data;
  if (code !== 0) {
    throw new Error(`${failureMsg} with exit code ${code}`);
  }
}

async function openDaytonaDashboard(connection: VMConnection): Promise<boolean> {
  if (connection.cloud !== "daytona") {
    return false;
  }

  const metadata = connection.metadata;
  const remotePort = metadata?.tunnel_remote_port;
  if (!remotePort || !connection.server_id) {
    return false;
  }

  const template = metadata?.tunnel_browser_url_template;
  const urlSuffix = template ? tunnelTemplateToUrlSuffix(template) : "";

  // Daytona exposes web UIs through signed preview URLs instead of a local SSH tunnel.
  const { getSignedPreviewBrowserUrl } = await import("../daytona/daytona.js");
  const url = await getSignedPreviewBrowserUrl(connection.server_id, Number.parseInt(remotePort, 10), urlSuffix);
  openBrowser(url);
  return true;
}

/** Connect to an existing VM via SSH */
export async function cmdConnect(connection: VMConnection, agentKey?: string): Promise<void> {
  const validateDaytona = connection.cloud === "daytona" ? await import("../daytona/daytona.js") : null;

  // SECURITY: Validate all connection parameters before use
  // This prevents command injection if the history file is corrupted or tampered with
  const connectValidation = tryCatch(() => {
    if (validateDaytona) {
      validateDaytona.validateDaytonaConnection(connection);
      return;
    }

    validateConnectionIP(connection.ip);
    validateUsername(connection.user);
    if (connection.server_name) {
      validateServerIdentifier(connection.server_name);
    }
    if (connection.server_id) {
      validateServerIdentifier(connection.server_id);
    }
  });
  if (!connectValidation.ok) {
    logError(`Security validation failed: ${getErrorMessage(connectValidation.error)}`);
    p.log.info("Your agentsea history file may be corrupted or tampered with.");
    p.log.info(`Location: ${getHistoryPath()}`);
    p.log.info(`To fix: edit the file and remove the invalid entry, or run '${AGENTSEA_CLI} list --clear'`);
    process.exit(1);
  }

  // Handle Sprite console connections
  if (connection.ip === "sprite-console" && connection.server_name) {
    p.log.step(`Connecting to sprite ${pc.bold(connection.server_name)}...`);
    return runInteractiveCommand(
      "sprite",
      [
        "console",
        "-s",
        connection.server_name,
      ],
      "Sprite console connection failed",
      `sprite console -s ${connection.server_name}`,
    );
  }

  if (connection.cloud === "daytona" && connection.server_id) {
    if (agentKey) {
      const { ensureDaytonaAutoUpdate } = await import("../daytona/auto-update.js");

      // Daytona auto-update runs as an SDK-managed background session, so reconnects
      // need to re-arm it after a sandbox stop/start cycle.
      await ensureDaytonaAutoUpdate(connection, agentKey);
    }
    p.log.step(`Connecting to Daytona sandbox ${pc.bold(connection.server_name || connection.server_id)}...`);
    const { buildInteractiveSshArgs } = await import("../daytona/daytona.js");
    const args = await buildInteractiveSshArgs(connection.server_id);
    return runInteractiveCommand(args[0], args.slice(1), "Daytona SSH connection failed", `${AGENTSEA_CLI} last`);
  }

  // Handle SSH connections
  p.log.step(`Connecting to ${pc.bold(connection.ip)}...`);
  const sshCmd = `ssh ${connection.user}@${connection.ip}`;
  const keyOpts = getSshKeyOpts(await ensureSshKeys());

  return runInteractiveCommand(
    "ssh",
    [
      ...SSH_INTERACTIVE_OPTS,
      ...keyOpts,
      `${connection.user}@${connection.ip}`,
    ],
    "SSH connection failed",
    sshCmd,
  );
}

/** SSH into a VM and launch the agent directly */
export async function cmdEnterAgent(
  connection: VMConnection,
  agentKey: string,
  manifest: Manifest | null,
): Promise<void> {
  const validateDaytona = connection.cloud === "daytona" ? await import("../daytona/daytona.js") : null;

  // SECURITY: Validate all connection parameters before use
  const enterValidation = tryCatch(() => {
    if (validateDaytona) {
      validateDaytona.validateDaytonaConnection(connection);
    } else {
      validateConnectionIP(connection.ip);
      validateUsername(connection.user);
      if (connection.server_name) {
        validateServerIdentifier(connection.server_name);
      }
      if (connection.server_id) {
        validateServerIdentifier(connection.server_id);
      }
    }
    if (connection.launch_cmd) {
      validateLaunchCmd(connection.launch_cmd);
    }
  });
  if (!enterValidation.ok) {
    logError(`Security validation failed: ${getErrorMessage(enterValidation.error)}`);
    p.log.info("Your agentsea history file may be corrupted or tampered with.");
    p.log.info(`Location: ${getHistoryPath()}`);
    p.log.info(`To fix: edit the file and remove the invalid entry, or run '${AGENTSEA_CLI} list --clear'`);
    process.exit(1);
  }

  const agentDef = manifest?.agents?.[agentKey];

  // Prefer the launch command stored at agentsea time (captures dynamic state),
  // fall back to manifest definition, then to agent key as last resort
  const storedCmd = connection.launch_cmd;
  let remoteCmd: string;
  if (storedCmd) {
    // Stored command already includes source ~/.agentsearc, PATH setup, etc.
    remoteCmd = storedCmd;
  } else {
    const launchCmd = agentDef?.launch ?? agentKey;
    const preLaunch = agentDef?.pre_launch;
    // Validate pre_launch and launch separately — pre_launch may contain
    // shell redirections (>, 2>&1) and backgrounding (&) that are invalid
    // in a launch command but valid for background daemon setup (#2474)
    if (preLaunch) {
      validatePreLaunchCmd(preLaunch);
    }
    validateLaunchCmd(`source ~/.agentsearc 2>/dev/null; ${launchCmd}`);
    const parts = [
      "source ~/.agentsearc 2>/dev/null",
    ];
    if (preLaunch) {
      parts.push(preLaunch);
    }
    parts.push(launchCmd);
    remoteCmd = parts.reduce((acc, part) => {
      if (!acc) {
        return part;
      }
      const sep = acc.trimEnd().endsWith("&") ? " " : "; ";
      return acc + sep + part;
    }, "");
  }

  const agentName = agentDef?.name || agentKey;

  // Handle Sprite connections — use `sprite exec -tty` to run a command interactively.
  // `sprite console` does NOT accept arguments; it is a pure interactive shell.
  if (connection.ip === "sprite-console" && connection.server_name) {
    p.log.step(`Entering ${pc.bold(agentName)} on sprite ${pc.bold(connection.server_name)}...`);
    return runInteractiveCommand(
      "sprite",
      [
        "exec",
        "-s",
        connection.server_name,
        "-tty",
        "--",
        "bash",
        "-lc",
        remoteCmd,
      ],
      `Failed to enter ${agentName}`,
      `sprite exec -s ${connection.server_name} -tty -- bash -lc '${remoteCmd}'`,
    );
  }

  if (connection.cloud === "daytona" && connection.server_id) {
    const { ensureDaytonaAutoUpdate } = await import("../daytona/auto-update.js");

    // Reconnects are the earliest reliable point to restore Daytona's background
    // updater after the sandbox has been restarted.
    await ensureDaytonaAutoUpdate(connection, agentKey);

    // Open the preview URL before entering the shell because Daytona dashboards are
    // exposed via signed URLs, not via the SSH tunnel flow used by VM clouds.
    await openDaytonaDashboard(connection);
    p.log.step(
      `Entering ${pc.bold(agentName)} on Daytona sandbox ${pc.bold(connection.server_name || connection.server_id)}...`,
    );
    const { runInteractiveDaytonaCommand } = await import("../daytona/daytona.js");
    const exitCode = await runInteractiveDaytonaCommand(connection.server_id, remoteCmd);
    if (exitCode !== 0) {
      throw new Error(`Failed to enter ${agentName} with exit code ${exitCode}`);
    }
    return;
  }

  // Re-establish SSH tunnel for web dashboard if tunnel metadata was persisted at agentsea time
  let tunnelHandle: SshTunnelHandle | undefined;
  let t3PairingWatcher: { stop: () => void } | undefined;
  const tunnelPort = connection.metadata?.tunnel_remote_port;
  if (tunnelPort && connection.ip !== "sprite-console") {
    // SECURITY: Validate tunnel metadata before use (prevent phishing via tampered history)
    const tunnelValidation = tryCatch(() => {
      validateTunnelPort(tunnelPort);
      const tpl = connection.metadata?.tunnel_browser_url_template;
      if (tpl) {
        validateTunnelUrl(tpl);
      }
    });
    if (!tunnelValidation.ok) {
      logError(`Security validation failed: ${getErrorMessage(tunnelValidation.error)}`);
      p.log.info("Your agentsea history file may be corrupted or tampered with.");
      p.log.info(`Location: ${getHistoryPath()}`);
      p.log.info(`To fix: edit the file and remove the invalid entry, or run '${AGENTSEA_CLI} list --clear'`);
      process.exit(1);
    }

    const tunnelResult = await asyncTryCatchIf(isOperationalError, async () => {
      const keys = await ensureSshKeys();
      tunnelHandle = await startSshTunnel({
        host: connection.ip,
        user: connection.user,
        remotePort: Number(tunnelPort),
        sshKeyOpts: getSshKeyOpts(keys),
      });
      const urlTemplate = connection.metadata?.tunnel_browser_url_template;
      if (agentKey === "t3code") {
        t3PairingWatcher = startT3PairingBrowserWatcher({
          ip: connection.ip,
          user: connection.user,
          sshKeyOpts: getSshKeyOpts(keys),
          localPort: tunnelHandle.localPort,
        });
      } else if (urlTemplate) {
        await openAgentTunnelBrowser(agentKey, connection, tunnelHandle.localPort, urlTemplate);
      }
    });
    if (!tunnelResult.ok) {
      logWarn("Web dashboard tunnel failed — dashboard unavailable this session");
    }
  }

  // Check for security alerts before entering the session
  const keyOpts = getSshKeyOpts(await ensureSshKeys());
  await checkSecurityAlerts(connection.ip, connection.user, keyOpts);

  // Standard SSH connection with agent launch
  p.log.step(`Entering ${pc.bold(agentName)} on ${pc.bold(connection.ip)}...`);
  const tunnelPortExport =
    tunnelHandle && agentKey === "t3code"
      ? `export AGENTSEA_TUNNEL_LOCAL_PORT=${tunnelHandle.localPort}; `
      : "";
  const quotedRemoteCmd = shellQuote(`${tunnelPortExport}${remoteCmd}`);
  await runInteractiveCommand(
    "ssh",
    [
      ...SSH_INTERACTIVE_OPTS,
      ...keyOpts,
      `${connection.user}@${connection.ip}`,
      "--",
      `bash -lc ${quotedRemoteCmd}`,
    ],
    `Failed to enter ${agentName}`,
    `ssh -t ${connection.user}@${connection.ip} -- bash -lc ${quotedRemoteCmd}`,
  );
  if (tunnelHandle) {
    tunnelHandle.stop();
  }
  t3PairingWatcher?.stop();
}

/** Open the web dashboard for a VM by establishing an SSH tunnel and launching the browser.
 *  Blocks until the user presses Enter, then tears down the tunnel. */
export async function cmdOpenDashboard(connection: VMConnection, agentKey?: string): Promise<void> {
  if (connection.cloud === "daytona") {
    const { validateDaytonaConnection } = await import("../daytona/daytona.js");
    const validation = tryCatch(() => validateDaytonaConnection(connection));
    if (!validation.ok) {
      logError(`Security validation failed: ${getErrorMessage(validation.error)}`);
      return;
    }
    const opened = await openDaytonaDashboard(connection);
    if (!opened) {
      logError("No dashboard metadata found for this Daytona sandbox.");
      return;
    }
    p.log.success("Opened Daytona preview URL in your browser.");
    return;
  }

  const validation = tryCatch(() => {
    validateConnectionIP(connection.ip);
    validateUsername(connection.user);
  });
  if (!validation.ok) {
    logError(`Security validation failed: ${getErrorMessage(validation.error)}`);
    return;
  }

  const tunnelPort = connection.metadata?.tunnel_remote_port;
  const urlTemplate = connection.metadata?.tunnel_browser_url_template;
  if (!tunnelPort) {
    logError("No dashboard tunnel info found for this server.");
    return;
  }

  // SECURITY: Validate tunnel metadata before use (prevent phishing via tampered history)
  const tunnelValidation = tryCatch(() => {
    validateTunnelPort(tunnelPort);
    if (urlTemplate) {
      validateTunnelUrl(urlTemplate);
    }
  });
  if (!tunnelValidation.ok) {
    logError(`Security validation failed: ${getErrorMessage(tunnelValidation.error)}`);
    p.log.info("Your agentsea history file may be corrupted or tampered with.");
    p.log.info(`Location: ${getHistoryPath()}`);
    p.log.info(`To fix: edit the file and remove the invalid entry, or run '${AGENTSEA_CLI} list --clear'`);
    return;
  }

  const keys = await ensureSshKeys();
  const resolvedAgent = agentKey ?? "";

  if (resolvedAgent === "hermes") {
    p.log.step("Ensuring Hermes dashboard is running on the VM...");
    const hermesScript = buildHermesDashboardStartScript(120);
    const hermesResult = await asyncTryCatchIf(isOperationalError, async () => {
      const proc = Bun.spawn(
        [
          "ssh",
          ...SSH_BASE_OPTS,
          ...getSshKeyOpts(keys),
          `${connection.user}@${connection.ip}`,
          hermesScript,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error("Hermes dashboard did not become healthy on the VM");
      }
    });
    if (!hermesResult.ok) {
      logError(
        `Hermes dashboard is not running on this server (${getErrorMessage(hermesResult.error)}).`,
      );
      p.log.info("SSH to the VM and check: tail -40 /tmp/hermes-dashboard.log");
      p.log.info("The Hermes TUI still works via agentsea connect.");
      return;
    }
  }

  p.log.step("Opening SSH tunnel to dashboard...");
  const tunnelResult = await asyncTryCatchIf(isOperationalError, () =>
    startSshTunnel({
      host: connection.ip,
      user: connection.user,
      remotePort: Number(tunnelPort),
      sshKeyOpts: getSshKeyOpts(keys),
    }),
  );
  if (!tunnelResult.ok) {
    logError("Failed to open SSH tunnel to dashboard.");
    return;
  }

  const handle = tunnelResult.data;
  if (resolvedAgent === "t3code") {
    logT3PairingHandoff(handle.localPort);
    const watcher = startT3PairingBrowserWatcher({
      ip: connection.ip,
      user: connection.user,
      sshKeyOpts: getSshKeyOpts(keys),
      localPort: handle.localPort,
    });
    p.log.success("Waiting for T3 Code — pairing URL will open automatically when the server is ready.");
    p.log.info("Press Enter to close the dashboard tunnel.");
    await new Promise<void>((resolve) => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once("data", () => resolve());
    });
    watcher.stop();
    handle.stop();
    p.log.step("Dashboard tunnel closed.");
    return;
  }

  if (urlTemplate) {
    const url = urlTemplate.replace("__PORT__", String(handle.localPort));
    openBrowser(url);
    p.log.success(`Dashboard opened at ${pc.cyan(url)}`);
    const wslAlt = rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(url);
    if (wslAlt !== url) {
      p.log.info(`Windows browser from WSL: if localhost fails, use ${pc.cyan(wslAlt)}`);
    }
  } else {
    p.log.success(`Dashboard tunnel open on localhost:${handle.localPort}`);
  }

  p.log.info("Press Enter to close the dashboard tunnel.");
  await new Promise<void>((resolve) => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  handle.stop();
  p.log.step("Dashboard tunnel closed.");
}
