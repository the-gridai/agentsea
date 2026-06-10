// t3-config.ts  T3 Code settings for The Grid (Codex provider + model defaults).

import type { CloudRunner } from "./agent-setup.js";
import { uploadConfigFile } from "./agent-setup.js";
import { asyncTryCatch } from "./result.js";
import { SSH_BASE_OPTS } from "./ssh.js";
import { logAlwaysInfo, logInfo, logStep, openBrowser, rewriteLocalhostHttpUrlForWindowsBrowserFromWsl, shellQuote, validateModelId } from "./ui.js";
import { GRID_INFERENCE_DEFAULT_MODEL_ID } from "./vendor-routing.js";

/** Default T3 Code listen port (see t3 defaults). */
export const T3_REMOTE_PORT = 3773;

/** T3 Code state directory (see t3 `deriveServerPaths`). */
export const T3_USERDATA_DIR = "$HOME/.t3/userdata";

/** Relative to home; uploaded as `$HOME/.t3/userdata/settings.json`. */
export const T3_SETTINGS_REMOTE_PATH = `${T3_USERDATA_DIR}/settings.json`;

/** T3 hardcodes these OpenAI slugs  expose agent-standard in the provider model list. */
export const T3_CODEX_UI_MODEL_ALIASES = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;

export function resolveT3GridModelId(modelId?: string): string {
  if (typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())) {
    return modelId.trim();
  }
  return GRID_INFERENCE_DEFAULT_MODEL_ID;
}

/**
 * Seed ~/.t3/userdata/settings.json so title generation and provider pickers prefer the Grid
 * catalogue id. Thread turns still request gpt-5.4 by default  those are catalogue id.
 */
export function buildT3GridSettingsJson(modelId?: string): string {
  const model = resolveT3GridModelId(modelId);
  const customModels = [model, ...T3_CODEX_UI_MODEL_ALIASES.filter((m) => m !== model)];
  return `${JSON.stringify(
    {
      textGenerationModelSelection: {
        instanceId: "codex",
        model,
      },
      providers: {
        codex: {
          enabled: true,
          customModels,
        },
      },
    },
    null,
    2,
  )}\n`;
}

export async function setupT3Settings(runner: CloudRunner, modelId?: string): Promise<void> {
  logStep("Configuring T3 Code settings for The Grid...");
  const selectedModel = resolveT3GridModelId(modelId);
  await runner.runServer(`mkdir -p ${T3_USERDATA_DIR}`);
  await uploadConfigFile(runner, buildT3GridSettingsJson(selectedModel), T3_SETTINGS_REMOTE_PATH);
  await runner.runServer(`chmod 600 ${T3_SETTINGS_REMOTE_PATH}`);
  logInfo(`T3 Code settings written (${selectedModel}, codex provider)`);
}

/** Shell prefix: agentsea env and codex on PATH for T3 launch. */
export const T3_LAUNCH_SHELL_PREFIX = [
  "source ~/.agentsearc 2>/dev/null",
  "source ~/.zshrc 2>/dev/null",
  'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:$PATH"',
  "export THEGRID_API_KEY OPENAI_API_KEY",
].join("; ");

/** Shell command to launch T3 on loopback (matches SSH tunnel target on the VM). */
export const T3_SERVER_LAUNCH = "t3 --port 3773 --host 127.0.0.1 --no-browser";

/** Full remote launch: env prefix + T3 server (pairing URL is opened by agentsea locally). */
export const T3_LAUNCH_CMD = `${T3_LAUNCH_SHELL_PREFIX}; ${T3_SERVER_LAUNCH}`;

/** @deprecated Use T3_LAUNCH_CMD  pipe/while breaks under bash -c quoting. */
export const T3_LAUNCH_WITH_PAIRING_HINT = T3_LAUNCH_CMD;

/** Browser URL for T3 pairing through an SSH tunnel (use tunnel local port, not remote 3773). */
export function buildT3PairingBrowserUrl(localPort: number, token: string): string {
  const params = new URLSearchParams([["token", token]]);
  return `http://127.0.0.1:${localPort}/pair#${params.toString()}`;
}

/** Rewrite a remote pairingUrl log line (localhost:3773) for the local tunnel port. */
export function rewriteT3RemotePairingUrl(remotePairingUrl: string, localPort: number): string | null {
  try {
    const url = new URL(remotePairingUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const token = hashParams.get("token")?.trim();
    if (!token) {
      return null;
    }
    return buildT3PairingBrowserUrl(localPort, token);
  } catch {
    return null;
  }
}

export function buildT3IssuePairingJsonRemoteCmd(localPort: number): string {
  const baseUrl = `http://127.0.0.1:${localPort}`;
  return `${T3_LAUNCH_SHELL_PREFIX}; t3 auth pairing create --json --base-url ${shellQuote(baseUrl)}`;
}

export function parseT3PairingCreateJson(stdout: string): { pairUrl?: string; credential?: string } | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as { credential?: string; pairUrl?: string };
      if (typeof parsed.pairUrl === "string" || typeof parsed.credential === "string") {
        return parsed;
      }
    } catch {
      // try next line
    }
  }
  return null;
}

/**
 * Issue a fresh T3 client pairing URL via `t3 auth pairing create` on the VM.
 * Works while T3 is running (or after first boot once auth DB exists).
 */
export async function issueT3PairingBrowserUrl(
  ip: string,
  user: string,
  sshKeyOpts: string[],
  localPort: number,
): Promise<string | null> {
  const cmd = buildT3IssuePairingJsonRemoteCmd(localPort);
  const fullCmd = `export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH" && bash -c ${shellQuote(cmd)}`;
  const runResult = await asyncTryCatch(async () => {
    const proc = Bun.spawn(
      ["ssh", ...SSH_BASE_OPTS, ...sshKeyOpts, `${user}@${ip}`, fullCmd],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, exitCode };
  });
  if (!runResult.ok || runResult.data.exitCode !== 0) {
    return null;
  }
  const parsed = parseT3PairingCreateJson(runResult.data.stdout);
  if (parsed?.pairUrl) {
    return parsed.pairUrl;
  }
  if (parsed?.credential) {
    return buildT3PairingBrowserUrl(localPort, parsed.credential);
  }
  return null;
}

export function logT3PairingHandoff(localPort: number, pairingUrl?: string): void {
  const cookieHint =
    "If you previously opened T3 on localhost, use a private/incognito window or delete localhost cookies first.";
  if (pairingUrl) {
    logAlwaysInfo(
      [
        cookieHint,
        "T3 Code pairing URL (open this in your browser  use 127.0.0.1, not the localhost:3773 link from T3 logs):",
        pairingUrl,
      ].join("\n"),
    );
    const wslAlt = rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(pairingUrl);
    if (wslAlt !== pairingUrl) {
      logAlwaysInfo(`Windows browser from WSL:\n${wslAlt}`);
    }
    return;
  }
  logAlwaysInfo(
    [
      cookieHint,
      "T3 Code requires browser pairing  ignore the localhost:3773 link in T3 server logs.",
      "When T3 starts, agentsea will print/open the correct URL, or copy the token and open:",
      `  http://127.0.0.1:${localPort}/pair#token=TOKEN_FROM_LOG`,
    ].join("\n"),
  );
}

/** Poll the SSH tunnel, issue a fresh pairing link, and open the browser once T3 is listening. */
export function startT3PairingBrowserWatcher(opts: {
  ip: string;
  user: string;
  sshKeyOpts: string[];
  localPort: number;
}): { stop: () => void } {
  let cancelled = false;
  void (async () => {
    for (let attempt = 0; attempt < 90 && !cancelled; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${opts.localPort}/`, { signal: AbortSignal.timeout(2000) });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      const pairingUrl = await issueT3PairingBrowserUrl(
        opts.ip,
        opts.user,
        opts.sshKeyOpts,
        opts.localPort,
      );
      if (pairingUrl && !cancelled) {
        logT3PairingHandoff(opts.localPort, pairingUrl);
        openBrowser(pairingUrl);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  })();
  return {
    stop: () => {
      cancelled = true;
    },
  };
}
