// shared/agent-setup.ts — Shared agent helpers + definitions for SSH-based clouds
// Cloud-agnostic: receives runServer/uploadFile via CloudRunner interface.

import type { AgentConfig } from "./agents.js";
import type { Result } from "./ui.js";

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getErrorMessage } from "@agentsea/sdk";
import { getCdnOrigin } from "./cdn.js";
import { setupCursorProxy, startCursorProxy } from "./cursor-proxy.js";
import { gridInferenceOverrideEnvLine, resolveGridAnthropicMessagesClientBase, resolveGridInferenceApiBase, resolveGridOpenClawMessagesBase } from "./grid-api.js";
import { JUNIE_LAUNCH_SHELL_PREFIX, setupJunieConfig, startJunieLiteLlmProxy } from "./junie-config.js";
import { setupT3Settings, T3_LAUNCH_CMD } from "./t3-config.js";
import { getTmpDir } from "./paths.js";
import { asyncTryCatch, asyncTryCatchIf, isOperationalError, tryCatchIf } from "./result.js";
import { validateRemotePath } from "./ssh.js";
import { isAgentseaVerbose } from "./verbosity.js";
import {
  Err,
  jsonEscape,
  logAlwaysStep,
  logError,
  logInfo,
  logStep,
  logWarn,
  Ok,
  prompt,
  shellQuote,
  validateModelId,
  withRetry,
} from "./ui.js";
import {
  GRID_INFERENCE_DEFAULT_MODEL_ID,
  OPENCLAW_GRID_MODEL_CONTEXT_WINDOW,
  OPENCLAW_GRID_MODEL_MAX_TOKENS,
  OPENCLAW_GRID_PROVIDER_ID,
  VENDOR_CHAT_MODEL_DEFAULT,
  VENDOR_CODEX_MODEL_PROVIDER_KEY,
  VENDOR_KILO_PROVIDER_TYPE_VALUE,
} from "./vendor-routing.js";

/** Optional `THEGRID_API_URL=…` for ~/.agentsearc when a local override is active. */
function agentsearcGridInferenceExtras(): string[] {
  const line = gridInferenceOverrideEnvLine();
  return line ? [line] : [];
}

const CODEX_LITELLM_PORT = 4141;
const CODEX_LITELLM_BASE_URL = `http://127.0.0.1:${CODEX_LITELLM_PORT}/v1`;

/** Hermes custom provider cannot follow api.thegrid.ai → synapse 307 redirects; use a local proxy like Codex. */
const HERMES_LITELLM_PORT = 4142;
const HERMES_LITELLM_BASE_URL = `http://127.0.0.1:${HERMES_LITELLM_PORT}/v1`;

/**
 * Remote shell: ensure ~/.litellm-venv has litellm[proxy]. Shared by Codex,
 * Hermes, Junie.
 *
 * sudo/apt is the last resort, not the default: on a fresh VM image we may need
 * `apt-get install python3-venv`, but most machines (and all repeat runs)
 * already have a working `python3 -m venv`. We therefore only invoke apt/sudo
 * when `python3` genuinely cannot create a venv — which keeps local runs
 * non-interactive (no sudo password prompt) and avoids touching the apt index
 * (and its unrelated third-party-repo GPG warnings) when nothing is needed.
 */
export const LITELLM_VENV_SETUP = [
  '_sudo=""; [ "$(id -u)" != "0" ] && _sudo="sudo"',
  // Only reach for apt/sudo if Python can't stand up a venv (incl. ensurepip)
  // on its own. This is the only step that needs root, so guarding it is what
  // removes the sudo prompt on typical local machines.
  'if ! python3 -c "import venv, ensurepip" >/dev/null 2>&1; then',
  "  if command -v apt-get >/dev/null 2>&1; then",
  '    command -v python3 >/dev/null 2>&1 || { $_sudo apt-get update -qq && $_sudo apt-get install -y -qq python3 || exit 1; }',
  "    $_sudo apt-get update -qq || true",
  '    _py_ver=$(python3 -c "import sys; print(f\\"{sys.version_info.major}.{sys.version_info.minor}\\")" 2>/dev/null || echo "3")',
  '    if apt-cache show "python${_py_ver}-venv" >/dev/null 2>&1; then',
  '      $_sudo apt-get install -y "python${_py_ver}-venv" || exit 1',
  "    elif apt-cache show python3-venv >/dev/null 2>&1; then",
  "      $_sudo apt-get install -y python3-venv || exit 1",
  "    else",
  '      echo "No python3-venv package available via apt" >&2; exit 1',
  "    fi",
  "  else",
  '    echo "python3 cannot create a venv and apt-get is unavailable" >&2; exit 1',
  "  fi",
  "fi",
  'if [ -d "$HOME/.litellm-venv" ] && [ ! -x "$HOME/.litellm-venv/bin/litellm" ]; then rm -rf "$HOME/.litellm-venv"; fi',
  'if [ ! -x "$HOME/.litellm-venv/bin/litellm" ]; then',
  '  rm -rf "$HOME/.litellm-venv"',
  '  python3 -m venv "$HOME/.litellm-venv" || { echo "python3 -m venv failed" >&2; exit 1; }',
  '  "$HOME/.litellm-venv/bin/pip" install -q --upgrade pip',
  "fi",
  // pip runs inside the user-owned venv (no sudo); keeps litellm at >=1.85.0.
  '"$HOME/.litellm-venv/bin/pip" install -q --upgrade "litellm[proxy]>=1.85.0" || exit 1',
  'mkdir -p "$HOME/.local/bin"',
  'ln -sf "$HOME/.litellm-venv/bin/litellm" "$HOME/.local/bin/litellm"',
].join("\n");

/** True when Codex LiteLLM proxy responds on localhost (health endpoint). */
const CODEX_LITELLM_HEALTH_CHECK = `curl -sf "http://127.0.0.1:${CODEX_LITELLM_PORT}/health/liveliness" >/dev/null 2>&1`;

/** True when Hermes LiteLLM proxy responds on localhost (health endpoint). */
const HERMES_LITELLM_HEALTH_CHECK = `curl -sf "http://127.0.0.1:${HERMES_LITELLM_PORT}/health/liveliness" >/dev/null 2>&1`;

/** Strips empty tools=[], reasoning params, and json_schema (Grid supports json_object only). */
const CODEX_LITELLM_CALLBACKS_PY = `from litellm.integrations.custom_logger import CustomLogger
import json

class DropEmptyToolsHandler(CustomLogger):
    def _append_user_text(self, data: dict, suffix: str) -> None:
        if not suffix:
            return
        if isinstance(data.get("input"), str):
            data["input"] = data["input"] + suffix
            return
        messages = data.get("messages")
        if not isinstance(messages, list):
            return
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, str):
                    msg["content"] = content + suffix
                elif isinstance(content, list):
                    msg["content"] = content + [{"type": "text", "text": suffix}]
                else:
                    msg["content"] = suffix
                return

    def _schema_hint(self, schema) -> str:
        if not schema:
            return " Respond with a single JSON object."
        try:
            encoded = json.dumps(schema, separators=(",", ":"))
        except Exception:
            encoded = str(schema)
        return f" Respond with JSON matching this schema: {encoded}."

    def _downgrade_json_schema(self, data: dict) -> dict:
        text = data.get("text")
        structured = False
        if isinstance(text, dict):
            fmt = text.get("format")
            if isinstance(fmt, dict) and fmt.get("type") == "json_schema":
                structured = True
                self._append_user_text(data, self._schema_hint(fmt.get("schema")))
                text["format"] = {"type": "json_object"}
            elif isinstance(fmt, dict) and fmt.get("type") == "json_object":
                structured = True
            text.pop("verbosity", None)

        response_format = data.get("response_format")
        if isinstance(response_format, dict) and response_format.get("type") == "json_schema":
            structured = True
            schema = response_format.get("schema")
            nested = response_format.get("json_schema")
            if schema is None and isinstance(nested, dict):
                schema = nested.get("schema")
            self._append_user_text(data, self._schema_hint(schema))
            data["response_format"] = {"type": "json_object"}
        elif isinstance(response_format, dict) and response_format.get("type") == "json_object":
            structured = True

        # codex exec --output-schema sends tool definitions that break Grid structured output.
        if structured:
            data.pop("tools", None)
            data.pop("tool_choice", None)
            data["parallel_tool_calls"] = False
            instructions = data.get("instructions")
            if isinstance(instructions, str) and len(instructions) > 500:
                data["instructions"] = (
                    "Return only JSON matching the requested schema. No tools, no prose."
                )
        return data

    def _normalize_upstream_request(self, data: dict) -> dict:
        if not isinstance(data, dict):
            return data
        if data.get("tools") == []:
            data.pop("tools", None)
        if "tools" not in data and data.get("tool_choice") in ("none", "auto"):
            data.pop("tool_choice", None)
        # T3 Code sends reasoning_effort=medium with gpt-5.4; The Grid hangs or returns empty content.
        data.pop("reasoning_effort", None)
        reasoning = data.get("reasoning")
        if isinstance(reasoning, dict):
            reasoning.pop("effort", None)
            reasoning.pop("summary", None)
            if not reasoning:
                data.pop("reasoning", None)
        return self._downgrade_json_schema(data)

    def _message_reasoning(self, msg) -> str | None:
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning:
            return reasoning
        fields = getattr(msg, "provider_specific_fields", None)
        if isinstance(fields, dict):
            nested = fields.get("reasoning_content")
            if nested:
                return nested
        return None

    def _normalize_upstream_response(self, response):
        try:
            choices = getattr(response, "choices", None)
            if not choices:
                return response
            for choice in choices:
                msg = getattr(choice, "message", None)
                if msg is None:
                    continue
                content = getattr(msg, "content", None)
                reasoning = self._message_reasoning(msg)
                if (content is None or content == "") and reasoning:
                    msg.content = reasoning
        except Exception:
            pass
        return response

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        return self._normalize_upstream_request(data)

    async def async_pre_call_deployment_hook(self, kwargs, call_type):
        return self._normalize_upstream_request(kwargs)

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        return self._normalize_upstream_response(response)

proxy_handler_instance = DropEmptyToolsHandler()
`;

/**
 * Base URL for Anthropic SDK / Claude Code (`ANTHROPIC_BASE_URL`). The SDK appends `/v1/messages`.
 * Grid serves Anthropic-compatible Messages on the messages-beta host, so the client base must be
 * the host without `/v1` (otherwise the SDK produces `/v1/v1/messages`).
 */

/** Default Control UI `/chat` session path (agentsea OpenClaw uses agent `main`). */
const OPENCLAW_CONTROL_UI_DEFAULT_CHAT_SESSION = "agent:main:main";

/**
 * Wrap an SSH-based async operation into a Result for use with withRetry.
 * - Transient SSH/connection errors → Err (retryable)
 * - Timeouts → throw (non-retryable: command may have already run)
 * - Everything else → throw (non-retryable: unknown failure)
 */
export async function wrapSshCall(op: Promise<void>): Promise<Result<void>> {
  const r = await asyncTryCatch(() => op);
  if (r.ok) {
    return Ok(undefined);
  }
  const msg = getErrorMessage(r.error);
  // Timeouts are NOT retryable — the command may have completed on the
  // remote but we lost the connection before seeing the exit code.
  if (msg.includes("timed out") || msg.includes("timeout")) {
    throw r.error;
  }
  // All other SSH errors (connection refused, reset, etc.) are retryable.
  return Err(new Error(msg));
}

// ─── CloudRunner interface ──────────────────────────────────────────────────

export interface CloudRunner {
  runServer(cmd: string, timeoutSecs?: number): Promise<void>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  /**
   * Start a long-lived background service (e.g. a LiteLLM proxy) and return once
   * it has been launched — NOT when it exits.
   *
   * Local mode only. On a VM, long-lived proxies are supervised by systemd (or a
   * background SSH process that outlives the connection), so SSH/VM runners leave
   * this undefined and use the in-script systemd/`setsid` path via `runServer`.
   *
   * Local mode cannot use that pattern: a `setsid … &` job started inside a
   * `Bun.spawn`-ed shell is torn down (SIGTERM) when that shell process is
   * reaped, so the proxy never persists. Implementations must launch the service
   * as a process detached from the ephemeral command shell (its own session,
   * stdio redirected to `logPath`) so it survives for the CLI session.
   *
   * @param cmd      Shell command that execs the service (e.g. `exec "$HOME/.local/bin/hermes-litellm-wrapper"`).
   * @param logPath  Absolute path to append the service's stdout/stderr to.
   */
  startService?(cmd: string, logPath: string): Promise<void>;
}

// ─── Script template validation ────────────────────────────────────────────

/**
 * Validate that a script template string does not contain JS template
 * interpolation patterns (`${...}`) before it is base64-encoded for shell
 * injection into systemd units or remote commands.
 *
 * Defense-in-depth: the scripts are currently static string arrays joined
 * with `\n`, so they should never contain interpolation markers. This guard
 * catches future regressions where a developer might accidentally introduce
 * template literal interpolation before encoding.
 *
 * Note: backticks alone are allowed (used in markdown content for skill
 * files), but `${` is always rejected as it indicates JS interpolation.
 */
export function validateScriptTemplate(script: string, label: string): void {
  if (/\$\{/.test(script)) {
    throw new Error(`Script template "${label}" contains \${} interpolation — refusing to encode`);
  }
}

// ─── Install helpers ────────────────────────────────────────────────────────

async function installAgent(
  runner: CloudRunner,
  agentName: string,
  installCmd: string,
  timeoutSecs?: number,
): Promise<void> {
  if (isAgentseaVerbose()) {
    logStep(`Installing ${agentName}...`);
  } else {
    logAlwaysStep(`Installing ${agentName}…`);
  }
  const r = await asyncTryCatch(() =>
    withRetry(`${agentName} install`, () => wrapSshCall(runner.runServer(installCmd, timeoutSecs)), 4, 10, true),
  );
  if (!r.ok) {
    logError(`${agentName} installation failed`);
    throw new Error(`${agentName} install failed`);
  }
  logInfo(`${agentName} installation completed`);
}

/**
 * Upload a config file to the remote machine via a temp file and mv.
 */
export async function uploadConfigFile(runner: CloudRunner, content: string, remotePath: string): Promise<void> {
  const safePath = validateRemotePath(remotePath);

  const tmpFile = join(getTmpDir(), `agentsea_config_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpFile, content, {
    mode: 0o600,
  });

  const uploadResult = await asyncTryCatch(() =>
    withRetry(
      "config upload",
      () =>
        wrapSshCall(
          (async () => {
            const tempRemote = `/tmp/agentsea_config_${Date.now()}`;
            await runner.uploadFile(tmpFile, tempRemote);
            await runner.runServer(
              `mkdir -p $(dirname "${safePath}") && chmod 600 ${shellQuote(tempRemote)} && mv ${shellQuote(tempRemote)} "${safePath}"`,
            );
          })(),
        ),
      4,
      5,
      true,
    ),
  );
  tryCatchIf(isOperationalError, () => unlinkSync(tmpFile));
  if (!uploadResult.ok) {
    throw uploadResult.error;
  }
}

// ─── Claude Code ─────────────────────────────────────────────────────────────

async function installClaudeCode(runner: CloudRunner): Promise<void> {
  logStep("Installing Claude Code...");

  const claudePath = "$HOME/.npm-global/bin:$HOME/.claude/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.n/bin";
  const pathSetup = `for rc in ~/.bashrc ~/.profile ~/.bash_profile ~/.zshrc; do grep -q '.claude/local/bin' "$rc" 2>/dev/null || printf '\\n# Claude Code PATH\\nexport PATH="$HOME/.claude/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"\\n' >> "$rc"; done`;
  const finalize = `claude install --force >/dev/null 2>&1 || true; ${pathSetup}`;

  const script = [
    `export PATH="${claudePath}:$PATH"`,
    `if [ -f ~/.bash_profile ] && grep -q 'agentsea:env\\|Claude Code PATH\\|agentsea:path' ~/.bash_profile 2>/dev/null; then rm -f ~/.bash_profile; fi`,
    `if command -v claude >/dev/null 2>&1; then ${finalize}; exit 0; fi`,
    `echo "==> Installing Claude Code (method 1/2: curl installer)..."`,
    "curl --proto '=https' -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 || true",
    `export PATH="${claudePath}:$PATH"`,
    `if command -v claude >/dev/null 2>&1; then ${finalize}; exit 0; fi`,
    "if ! command -v node >/dev/null 2>&1; then export N_PREFIX=$HOME/.n; curl --proto '=https' -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n | bash -s install 22 || true; export PATH=$N_PREFIX/bin:$PATH; fi",
    `echo "==> Installing Claude Code (method 2/2: npm)..."`,
    "npm install -g @anthropic-ai/claude-code || true",
    `export PATH="${claudePath}:$PATH"`,
    `if command -v claude >/dev/null 2>&1; then ${finalize}; exit 0; fi`,
    "exit 1",
  ].join("\n");

  const r = await asyncTryCatch(() => runner.runServer(script, 300));
  if (!r.ok) {
    logError("Claude Code installation failed");
    throw new Error("Claude Code install failed");
  }
  logInfo("Claude Code agent installed successfully");
}

async function setupClaudeCodeConfig(runner: CloudRunner, apiKey: string, modelId?: string): Promise<void> {
  logStep("Configuring Claude Code...");

  const selectedModel =
    typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())
      ? modelId.trim()
      : GRID_INFERENCE_DEFAULT_MODEL_ID;
  const escapedKey = jsonEscape(apiKey);
  const escapedModel = jsonEscape(selectedModel);
  // The Grid at ANTHROPIC_BASE_URL: prefer bearer auth via ANTHROPIC_AUTH_TOKEN.
  // Keep ANTHROPIC_API_KEY empty to avoid Claude's auth conflict warning when both are populated.
  const anthropicBase = resolveGridAnthropicMessagesClientBase();
  const settingsJson = `{
  "theme": "dark",
  "editor": "vim",
  "model": ${escapedModel},
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "0",
    "ANTHROPIC_BASE_URL": "${anthropicBase}",
    "ANTHROPIC_MODEL": ${escapedModel},
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_AUTH_TOKEN": ${escapedKey}
  },
  "permissions": {
    "defaultMode": "bypassPermissions",
    "dangerouslySkipPermissions": true
  }
}`;

  // Upload settings via SCP — avoids base64 interpolation into shell commands.
  await uploadConfigFile(runner, settingsJson, "$HOME/.claude/settings.json");

  // Build ~/.claude.json on the remote using $HOME so the workspace trust
  // entry uses the actual home directory path (e.g. /root, /home/user).
  // This pre-accepts the "Quick safety check" trust dialog for the home dir.
  const stateScript = [
    'printf \'{"hasCompletedOnboarding":true,"bypassPermissionsModeAccepted":true,"projects":{"%s":{"hasTrustDialogAccepted":true}}}\\n\' "$HOME" > ~/.claude.json',
    "chmod 600 ~/.claude.json",
    "touch ~/.claude/CLAUDE.md",
  ].join(" && ");

  await runner.runServer(stateScript);
  logInfo("Claude Code configured");
}

// ─── Cursor CLI Config ────────────────────────────────────────────────────────

// ─── GitHub Auth ─────────────────────────────────────────────────────────────

let githubAuthRequested = false;
let githubToken = "";
let hostGitName = "";
let hostGitEmail = "";

/** Read a git config value from the host machine, returning "" on failure. */
function readHostGitConfig(key: string): string {
  const result = tryCatchIf(isOperationalError, () => {
    const r = Bun.spawnSync(
      [
        "git",
        "config",
        "--global",
        key,
      ],
      {
        stdio: [
          "ignore",
          "pipe",
          "ignore",
        ],
      },
    );
    if (r.exitCode === 0) {
      return new TextDecoder().decode(r.stdout).trim();
    }
    return "";
  });
  return result.ok ? result.data : "";
}

async function detectGithubAuth(): Promise<void> {
  if (process.env.GITHUB_TOKEN) {
    githubToken = process.env.GITHUB_TOKEN;
  } else {
    const ghResult = tryCatchIf(isOperationalError, () => {
      const r = Bun.spawnSync(
        [
          "gh",
          "auth",
          "token",
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "ignore",
          ],
        },
      );
      if (r.exitCode === 0) {
        return new TextDecoder().decode(r.stdout).trim();
      }
      return "";
    });
    if (ghResult.ok && ghResult.data) {
      githubToken = ghResult.data;
    }
  }

  if (githubToken) {
    githubAuthRequested = true;
  }

  // Capture host git identity to propagate to the remote VM
  hostGitName = readHostGitConfig("user.name");
  hostGitEmail = readHostGitConfig("user.email");
}

export async function offerGithubAuth(runner: CloudRunner, explicitlyRequested?: boolean): Promise<void> {
  if (process.env.AGENTSEA_SKIP_GITHUB_AUTH) {
    return;
  }
  if (!githubAuthRequested && !explicitlyRequested) {
    return;
  }

  let ghCmd = `curl --proto '=https' -fsSL ${getCdnOrigin()}/shared/github-auth.sh | bash`;
  // Upload the token to a remote temp file so it never appears in `ps auxe`
  // process listings. We use runner.uploadFile() (SCP) — the same proven
  // pattern as uploadConfigFile(). A heredoc won't work here because all
  // cloud runners wrap commands in `bash -c ${shellQuote(cmd)}`, and
  // heredocs are not valid inside single-quoted `bash -c '...'` strings.
  let remoteTokenPath = "";
  if (githubToken) {
    const localTmpFile = join(getTmpDir(), `agentsea_gh_token_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    remoteTokenPath = `/tmp/agentsea_gh_token_${Date.now()}`;
    writeFileSync(localTmpFile, githubToken, {
      mode: 0o600,
    });
    const uploadResult = await asyncTryCatch(() => runner.uploadFile(localTmpFile, remoteTokenPath));
    tryCatchIf(isOperationalError, () => unlinkSync(localTmpFile));
    if (!uploadResult.ok) {
      throw uploadResult.error;
    }
    ghCmd = `export GITHUB_TOKEN=$(cat ${shellQuote(remoteTokenPath)}) && rm -f ${shellQuote(remoteTokenPath)} && ${ghCmd}`;
  }

  logStep("Installing and authenticating GitHub CLI on the remote server...");
  const ghSetup = await asyncTryCatchIf(isOperationalError, () => runner.runServer(ghCmd));
  if (!ghSetup.ok) {
    // Best-effort cleanup of remote token file if the command failed before rm ran
    if (remoteTokenPath) {
      await asyncTryCatchIf(isOperationalError, () => runner.runServer(`rm -f ${shellQuote(remoteTokenPath)}`));
    }
    logWarn("GitHub CLI setup failed (non-fatal, continuing)");
  }

  // Propagate host git identity to the remote VM
  if (hostGitName || hostGitEmail) {
    logStep("Configuring git identity on the remote server...");
    const cmds: string[] = [];
    if (hostGitName) {
      cmds.push(`git config --global user.name ${shellQuote(hostGitName)}`);
    }
    if (hostGitEmail) {
      cmds.push(`git config --global user.email ${shellQuote(hostGitEmail)}`);
    }
    const gitSetup = await asyncTryCatchIf(isOperationalError, () => runner.runServer(cmds.join(" && ")));
    if (gitSetup.ok) {
      logInfo("Git identity configured on remote server");
    } else {
      logWarn("Git identity setup failed (non-fatal, continuing)");
    }
  }
}

// ─── Codex CLI Config ────────────────────────────────────────────────────────

/** T3 Code hardcodes OpenAI model slugs when invoking `codex exec`; alias them to the Grid catalogue id. */
const T3_CODEX_HARDCODED_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;

function buildCodexLiteLlmYaml(
  model: string,
  upstreamModel: string,
  extraModelNames?: readonly string[],
): string {
  const inferenceBase = resolveGridInferenceApiBase();
  const modelNames = [model, ...(extraModelNames ?? [])];
  const modelList = modelNames
    .map(
      (modelName) => `  - model_name: "${modelName}"
    litellm_params:
      model: "${upstreamModel}"
      api_base: "${inferenceBase}"
      api_key: "os.environ/THEGRID_API_KEY"
      use_chat_completions_api: true
      drop_params: true`,
    )
    .join("\n");

  return `model_list:
${modelList}

litellm_settings:
  drop_params: true
  callbacks: codex_litellm_callbacks.proxy_handler_instance
`;
}

async function setupCodexConfig(
  runner: CloudRunner,
  modelId?: string,
  extraModelNames?: readonly string[],
): Promise<void> {
  logStep("Configuring Codex CLI for The Grid (OpenAI-compatible)...");
  const slot = VENDOR_CODEX_MODEL_PROVIDER_KEY;
  const model = normalizeGridCatalogModelId(
    typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())
      ? modelId.trim()
      : VENDOR_CHAT_MODEL_DEFAULT,
  );
  const upstreamModel = model.includes("/") ? model : `openai/${model}`;
  const config = `model = "${model}"
model_provider = "${slot}"
sandbox_mode = "danger-full-access"
model_reasoning_effort = "none"

[model_providers.${slot}]
name = "The Grid"
base_url = "${CODEX_LITELLM_BASE_URL}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`;
  await uploadConfigFile(runner, config, "$HOME/.codex/config.toml");

  const litellmConfig = buildCodexLiteLlmYaml(model, upstreamModel, extraModelNames);
  await uploadConfigFile(runner, litellmConfig, "$HOME/.codex/litellm.yaml");
  await uploadConfigFile(runner, CODEX_LITELLM_CALLBACKS_PY, "$HOME/.codex/codex_litellm_callbacks.py");

  logStep("Installing Codex LiteLLM proxy (python3-venv + litellm)...");
  const venvResult = await asyncTryCatch(() =>
    runner.runServer(LITELLM_VENV_SETUP, 300),
  );
  if (!venvResult.ok) {
    throw new Error(
      "Codex LiteLLM install failed — ensure python3-venv is available on the VM (see provisioning logs)",
    );
  }
}

async function startCodexLiteLlmProxy(runner: CloudRunner): Promise<void> {
  logStep("Starting Codex local responses proxy...");

  const wrapperScript = [
    "#!/bin/bash",
    'source "$HOME/.agentsearc" 2>/dev/null',
    'export PATH="$HOME/.local/bin:$HOME/.litellm-venv/bin:$PATH"',
    'export PYTHONPATH="$HOME/.codex"',
    "export THEGRID_API_KEY",
    `exec "$HOME/.litellm-venv/bin/litellm" --config "$HOME/.codex/litellm.yaml" --host 127.0.0.1 --port ${CODEX_LITELLM_PORT}`,
  ].join("\n");

  const unitFile = [
    "[Unit]",
    "Description=Codex LiteLLM proxy for The Grid",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/codex-litellm-wrapper",
    "Restart=always",
    "RestartSec=3",
    "User=__USER__",
    "Environment=HOME=__HOME__",
    "StandardOutput=append:/tmp/codex-litellm.log",
    "StandardError=append:/tmp/codex-litellm.log",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  validateScriptTemplate(wrapperScript, "codex-litellm-wrapper");
  validateScriptTemplate(unitFile, "codex-litellm-unit");

  const wrapperB64 = Buffer.from(wrapperScript).toString("base64");
  const unitB64 = Buffer.from(unitFile).toString("base64");

  const checkLines = [
    "source ~/.agentsearc 2>/dev/null",
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.litellm-venv/bin:$PATH"',
    'test -n "$THEGRID_API_KEY" || { echo "THEGRID_API_KEY missing from ~/.agentsearc" >&2; exit 1; }',
    'export THEGRID_API_KEY',
    'test -s "$HOME/.codex/litellm.yaml" || { echo "Missing ~/.codex/litellm.yaml" >&2; exit 1; }',
  ];
  const venvWrapperLines = [
    LITELLM_VENV_SETUP,
    'test -x "$HOME/.litellm-venv/bin/litellm" || { echo "litellm binary missing after venv setup" >&2; exit 1; }',
    "printf '%s' '" + wrapperB64 + "' | base64 -d > /tmp/codex-litellm-wrapper.tmp",
    "chmod +x /tmp/codex-litellm-wrapper.tmp",
  ];

  // Local mode: launch detached via runner.startService instead of the
  // in-shell `setsid … &`, which Bun tears down (see startLiteLlmProxyLocally).
  if (runner.startService) {
    await startLiteLlmProxyLocally(runner, {
      name: "Codex",
      port: CODEX_LITELLM_PORT,
      binName: "codex-litellm-wrapper",
      logPath: "/tmp/codex-litellm.log",
      healthCheck: CODEX_LITELLM_HEALTH_CHECK,
      prepLines: [...checkLines, ...venvWrapperLines],
    });
    return;
  }

  const script = [
    ...checkLines,
    `if ${CODEX_LITELLM_HEALTH_CHECK}; then echo "Codex proxy already running on :${CODEX_LITELLM_PORT}"; exit 0; fi`,
    ...venvWrapperLines,
    "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then",
    '  _sudo=""',
    '  [ "$(id -u)" != "0" ] && _sudo="sudo"',
    "  $_sudo mv /tmp/codex-litellm-wrapper.tmp /usr/local/bin/codex-litellm-wrapper",
    "  printf '%s' '" + unitB64 + "' | base64 -d > /tmp/codex-litellm.unit.tmp",
    '  sed -i "s|__USER__|$(whoami)|;s|__HOME__|$HOME|" /tmp/codex-litellm.unit.tmp',
    "  $_sudo mv /tmp/codex-litellm.unit.tmp /etc/systemd/system/codex-litellm.service",
    "  $_sudo systemctl daemon-reload",
    "  $_sudo systemctl enable codex-litellm 2>/dev/null",
    "  $_sudo systemctl restart codex-litellm",
    "else",
    // No systemd (e.g. macOS local runs): /usr/local/bin is not user-writable
    // and we have no sudo here, so install the wrapper into the user-owned
    // ~/.local/bin (already on PATH above) instead.
    '  mkdir -p "$HOME/.local/bin"',
    '  mv /tmp/codex-litellm-wrapper.tmp "$HOME/.local/bin/codex-litellm-wrapper"',
    "  pkill -f '[l]itellm.*4141' 2>/dev/null || true",
    "  sleep 1",
    "  if command -v setsid >/dev/null 2>&1; then",
    '    setsid "$HOME/.local/bin/codex-litellm-wrapper" >> /tmp/codex-litellm.log 2>&1 < /dev/null &',
    "  else",
    '    nohup "$HOME/.local/bin/codex-litellm-wrapper" >> /tmp/codex-litellm.log 2>&1 < /dev/null &',
    "  fi",
    "fi",
    "elapsed=0; while [ $elapsed -lt 120 ]; do",
    `  if ${CODEX_LITELLM_HEALTH_CHECK}; then echo "Codex proxy ready after $elapsed sec"; exit 0; fi`,
    "  sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Codex proxy failed to start within 120s" >&2',
    "if command -v systemctl >/dev/null 2>&1; then systemctl status codex-litellm --no-pager 2>/dev/null || true; fi",
    "tail -60 /tmp/codex-litellm.log 2>/dev/null || true",
    "exit 1",
  ].join("\n");

  const result = await asyncTryCatch(() => runner.runServer(script, 300));
  if (result.ok) {
    logInfo(`Codex proxy started on :${CODEX_LITELLM_PORT}`);
    return;
  }
  throw new Error(
    `Codex LiteLLM proxy failed to start on :${CODEX_LITELLM_PORT} — check /tmp/codex-litellm.log on the VM`,
  );
}

async function setupT3CodeConfig(runner: CloudRunner, modelId?: string): Promise<void> {
  await setupCodexConfig(runner, modelId, T3_CODEX_HARDCODED_MODELS);
  await setupT3Settings(runner, modelId);
}

// ─── OpenClaw Config ─────────────────────────────────────────────────────────

async function installChromeBrowser(runner: CloudRunner): Promise<void> {
  // Install Google Chrome for OpenClaw's browser tool (recommended by OpenClaw docs).
  // Snap Chromium on Ubuntu 24.04 fails — AppArmor confinement blocks CDP control.
  // Google Chrome .deb bypasses snap entirely and lands at /usr/bin/google-chrome.
  logStep("Installing Google Chrome for browser tool...");
  const result = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(
      "{ command -v google-chrome-stable >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1; } && { echo 'Chrome already installed'; exit 0; }; " +
        "curl --proto '=https' -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb && " +
        "sudo dpkg -i /tmp/google-chrome.deb; sudo apt-get install -f -y -qq; " +
        "rm -f /tmp/google-chrome.deb",
      120,
    ),
  );
  if (result.ok) {
    logInfo("Google Chrome installed");
  } else {
    logWarn("Google Chrome install failed (browser tool will be unavailable)");
  }
}

/**
 * Poll `openclaw status --json` until bootstrapPending is false.
 * Gives up after ~60 seconds — the dashboard will still work, it just
 * may require the user to wait a bit or refresh.
 */
async function waitForOpenclawBootstrap(runner: CloudRunner): Promise<void> {
  logStep("Waiting for OpenClaw bootstrap to complete...");

  const pollScript = [
    "source ~/.agentsearc 2>/dev/null",
    "export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH",
    "_start=$(date +%s)",
    "while true; do",
    "  _now=$(date +%s)",
    "  _elapsed=$((_now - _start))",
    "  if [ \"$_elapsed\" -ge 60 ]; then",
    '    echo "OpenClaw: bootstrapPending still true after ${_elapsed}s — continuing anyway"',
    "    exit 0",
    "  fi",
    "  _status=$(openclaw status --json 2>/dev/null) || { sleep 2; continue; }",
    // Use bun to safely parse JSON — avoids jq dependency
    "  _pending=$(printf '%s' \"$_status\" | bun -e '",
    "    const d = await Bun.stdin.text();",
    '    try { const o = JSON.parse(d); console.log(o.bootstrapPending === true ? "true" : "false"); }',
    '    catch { console.log("unknown"); }',
    "  ' 2>/dev/null)",
    '  if [ "$_pending" = "false" ]; then',
    '    if [ "$_elapsed" -lt 1 ]; then',
    '      echo "OpenClaw: bootstrapPending clear (<1s in this status poll — Chrome/install took longer separately)."',
    "    else",
    '      echo "OpenClaw: bootstrapPending clear (${_elapsed}s in this status poll)."',
    "    fi",
    "    exit 0",
    "  fi",
    "  sleep 2",
    "done",
  ].join("\n");

  const result = await asyncTryCatchIf(isOperationalError, () => runner.runServer(pollScript, 90));
  if (result.ok) {
    logInfo("OpenClaw bootstrapPending poll finished (see remote line above for wait duration)");
  } else {
    logWarn("Bootstrap readiness check failed (non-fatal, continuing)");
  }
}

/** OpenClaw `models.providers.thegrid` registers one slug — never OpenRouter placeholders. */
function normalizeGridCatalogModelId(modelId: string): string {
  const t = modelId.trim();
  if (!t || /^openrouter\//i.test(t)) {
    return GRID_INFERENCE_DEFAULT_MODEL_ID;
  }
  return t;
}
function openClawGridPrimaryModel(catalogModelId: string): string {
  return `${OPENCLAW_GRID_PROVIDER_ID}/${catalogModelId}`;
}

function openClawGridProviderModelEntry(catalogModelId: string): {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
} {
  return {
    id: catalogModelId,
    name: `The Grid (${catalogModelId})`,
    contextWindow: OPENCLAW_GRID_MODEL_CONTEXT_WINDOW,
    maxTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS,
  };
}

/**
 * Register `models.providers.thegrid` for OpenClaw against The Grid Anthropic-compatible surface.
 * We avoid the OpenAI-compatible redirect path here because OpenClaw's transport SSRF policy
 * can block cross-host redirects (`api.thegrid.ai` -> `synapse.thegrid.ai`) on some releases.
 */
async function mergeOpenClawGridInferenceProvider(
  runner: CloudRunner,
  catalogModelId: string,
  plaintextApiKey: string,
): Promise<void> {
  const ocPrimary = openClawGridPrimaryModel(catalogModelId);
  const openClawMessagesBase = resolveGridOpenClawMessagesBase();
  const inferLit = JSON.stringify(openClawMessagesBase);
  // OpenSSL-claw validates config by resolving `${THEGRID_API_KEY}` markers; systemd/gateway shells may not
  // export `THEGRID_*` yet. Persist the Grid key inlined (openclaw.json is chmod 600 on the VM).
  const apiKeyLit = JSON.stringify(plaintextApiKey);
  const mergeScript = [
    "import fs from 'fs';",
    `const apiKeyPlain = ${apiKeyLit};`,
    `const infer = ${inferLit};`,
    "const providerId = process.env.AGENTSEA_GRID_PROVIDER_ID || 'thegrid';",
    "const slug = process.env.AGENTSEA_GRID_CATALOG_MODEL;",
    "const ocPrimary = process.env.AGENTSEA_GRID_PRIMARY;",
    "if (!slug || !ocPrimary) { console.error('agentsea grid-merge: missing env'); process.exit(1); }",
    "const cfgPath = (process.env.HOME ?? '') + '/.openclaw/openclaw.json';",
    "const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));",
    "cfg.env ||= {};",
    `cfg.env.OPENAI_BASE_URL = ${inferLit};`,
    "cfg.env.THEGRID_API_KEY = apiKeyPlain;",
    "cfg.env.OPENAI_API_KEY = apiKeyPlain;",
    "cfg.models ||= {};",
    "cfg.models.mode = 'merge';",
    "cfg.models.providers = {",
    `  [providerId]: { baseUrl: infer, apiKey: apiKeyPlain, api: 'anthropic-messages', models: [{ id: slug, name: 'The Grid (' + slug + ')', contextWindow: ${OPENCLAW_GRID_MODEL_CONTEXT_WINDOW}, maxTokens: ${OPENCLAW_GRID_MODEL_MAX_TOKENS} }] },`,
    "};",
    "cfg.agents ||= {}; cfg.agents.defaults ||= {}; cfg.agents.defaults.model ||= {};",
    "cfg.agents.defaults.model.primary = ocPrimary;",
    "cfg.agents.defaults.models ||= {};",
    `cfg.agents.defaults.models[ocPrimary] = { alias: 'The Grid', params: { maxTokens: ${OPENCLAW_GRID_MODEL_MAX_TOKENS} } };`,
    "fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); fs.chmodSync(cfgPath, 0o600);",
  ].join(" ");

  const qb = !isAgentseaVerbose() ? " 2>/dev/null" : "";
  const merged = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(
      "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; " +
        `export AGENTSEA_GRID_CATALOG_MODEL=${shellQuote(catalogModelId)}; ` +
        `export AGENTSEA_GRID_PRIMARY=${shellQuote(ocPrimary)}; ` +
        `export AGENTSEA_GRID_PROVIDER_ID=${shellQuote(OPENCLAW_GRID_PROVIDER_ID)}; ` +
        `bun -e ${shellQuote(mergeScript)}${qb}`,
    ),
  );
  if (!merged.ok) {
    logWarn("Could not merge OpenClaw The Grid provider block — chat may fall back to built-in routing");
  }
}

async function setupOpenclawConfig(
  runner: CloudRunner,
  apiKey: string,
  modelId: string,
  token?: string,
  enabledSteps?: Set<string>,
): Promise<void> {
  const catalogModelId = normalizeGridCatalogModelId(modelId);

  logInfo(`OpenClaw configure (${catalogModelId}): Chrome → onboard → Grid merge → prefs.`);
  logStep("Configuring openclaw...");
  await runner.runServer("mkdir -p ~/.openclaw");
  const openClawMessagesBase = resolveGridOpenClawMessagesBase();

  // Chrome must be installed before config is written (config references its path).
  // This runs in configure() — not install() — so it works even with tarball installs.
  // Gate with enabledSteps — user can skip ~400 MB download via setup checkboxes.
  if (!enabledSteps || enabledSteps.has("browser")) {
    await installChromeBrowser(runner);
  }

  // Prompt for Telegram bot token before building the config JSON so we can
  // include it in a single atomic write.
  let telegramBotToken = "";
  if (enabledSteps?.has("telegram")) {
    logStep("Setting up Telegram...");
    const envToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.AGENTSEA_TELEGRAM_BOT_TOKEN ?? "";
    if (!envToken) {
      logInfo("To get a bot token:");
      logInfo("  1. Open Telegram and search for @BotFather");
      logInfo("  2. Send /newbot and follow the prompts");
      logInfo("  3. Copy the token (looks like 123456:ABC-DEF...)");
      logInfo("  Press Enter to skip if you don't have one yet.");
    }
    telegramBotToken = (envToken || (await prompt("Telegram bot token: "))).trim();
    if (!telegramBotToken) {
      logInfo("No token entered — set up Telegram via the web dashboard after launch");
    }
  }

  const gatewayToken = token ?? crypto.randomUUID().replace(/-/g, "");

  // OpenClaw onboarding: workspace + gateway token + custom Anthropic-compat probe (see docs.openclaw.ai/cli/onboard).
  // Use messages-beta (not api.thegrid.ai) so OpenClaw's SSRF guard never follows api → synapse redirects.
  // mergeOpenClawGridInferenceProvider then replaces any onboard provider stubs with models.providers.thegrid only.
  const onboardCmd =
    "source ~/.agentsearc 2>/dev/null; " +
    "export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; " +
    "openclaw onboard --non-interactive " +
    "--auth-choice custom-api-key " +
    `--custom-base-url ${shellQuote(openClawMessagesBase)} ` +
    `--custom-model-id ${shellQuote(catalogModelId)} ` +
    `--custom-api-key ${shellQuote(apiKey)} ` +
    "--secret-input-mode plaintext " +
    "--custom-compatibility anthropic " +
    "--gateway-auth token " +
    `--gateway-token ${shellQuote(gatewayToken)} ` +
    "--skip-health " +
    "--accept-risk";
  const onboardQuietTail = !isAgentseaVerbose() ? "> /tmp/openclaw-onboard.log 2>&1" : "";
  const onboardResult = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(onboardQuietTail ? `${onboardCmd} ${onboardQuietTail}` : onboardCmd, 120),
  );
  if (!onboardResult.ok) {
    logWarn("openclaw onboard failed — falling back to manual config");
    if (!isAgentseaVerbose()) {
      logAlwaysStep("Tip: on the droplet, run `tail -80 /tmp/openclaw-onboard.log` for full OpenClaw setup output.");
    }
    const ocPrimary = openClawGridPrimaryModel(catalogModelId);
    const fallbackConfig = JSON.stringify(
      {
        env: {
          THEGRID_API_KEY: apiKey,
          OPENAI_API_KEY: apiKey,
          OPENAI_BASE_URL: openClawMessagesBase,
        },
        gateway: {
          mode: "local",
          auth: {
            mode: "token",
            token: gatewayToken,
          },
          controlUi: {
            allowInsecureAuth: true,
            dangerouslyDisableDeviceAuth: true,
          },
        },
        models: {
          mode: "merge",
          providers: {
            [OPENCLAW_GRID_PROVIDER_ID]: {
              baseUrl: openClawMessagesBase,
              apiKey,
              api: "anthropic-messages",
              models: [openClawGridProviderModelEntry(catalogModelId)],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: ocPrimary,
            },
            models: {
              [ocPrimary]: {
                alias: "The Grid",
                params: {
                  maxTokens: OPENCLAW_GRID_MODEL_MAX_TOKENS,
                },
              },
            },
            sandbox: {
              mode: "off",
            },
          },
        },
      },
      null,
      2,
    );
    await uploadConfigFile(runner, fallbackConfig, "$HOME/.openclaw/openclaw.json");
  }

  await mergeOpenClawGridInferenceProvider(runner, catalogModelId, apiKey);

  // Batch all `openclaw config set` calls into ONE exec to reduce Sprite
  // connection overhead. Previously 4 separate exec calls, each triggering a
  // "Config overwrite" log line from OpenClaw. On Sprite (container-exec, not
  // persistent SSH), many sequential execs exhaust the connection and cause
  // "connection closed" / "context deadline exceeded" on later steps.
  //
  // Each individual config set is chained with `;` (not `&&`) so a failure
  // in one doesn't skip the rest — these are all non-fatal preferences.
  const q = !isAgentseaVerbose();
  const ocSfx = q ? " >/dev/null 2>&1" : "";
  const configCmds = [
    // Model primary + `models.providers.thegrid` are merged above (avoid `openrouter/*` → builtin OpenRouter auth).
    `openclaw config set agents.defaults.sandbox.mode off${ocSfx}`,
    `openclaw config set browser.executablePath /usr/bin/google-chrome-stable${ocSfx}`,
    `openclaw config set browser.noSandbox true${ocSfx}`,
    `openclaw config set browser.headless true${ocSfx}`,
    `openclaw config set browser.defaultProfile openclaw${ocSfx}`,
    `openclaw config set gateway.controlUi.allowInsecureAuth true${ocSfx}`,
    `openclaw config set gateway.controlUi.dangerouslyDisableDeviceAuth true${ocSfx}`,
  ];

  // Channel stubs so the dashboard renders channel cards
  const channelNames = [
    "telegram",
    "whatsapp",
    "discord",
    "slack",
    "signal",
    "googlechat",
    "bluebubbles",
  ].filter((ch) => !enabledSteps || enabledSteps.has(ch));
  for (const ch of channelNames) {
    configCmds.push(`openclaw config set channels.${ch}.enabled true${ocSfx}`);
  }

  const batchResult = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(
      "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; " +
        configCmds.join("; "),
    ),
  );
  if (!batchResult.ok) {
    logWarn("Some config settings may have failed (non-fatal)");
  }

  // Guaranteed JSON merge — `openclaw config set gateway.controlUi.*` can fail silently on
  // some releases; Without these flags the Control UI may require device identity over HTTP.
  const controlUiMerge = [
    "import fs from 'fs';",
    "const cfgPath = process.env.HOME + '/.openclaw/openclaw.json';",
    "const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));",
    "cfg.gateway ||= {};",
    "const prev = typeof cfg.gateway.controlUi === 'object' && cfg.gateway.controlUi !== null ? cfg.gateway.controlUi : {};",
    "cfg.gateway.controlUi = Object.assign(prev, { allowInsecureAuth: true, dangerouslyDisableDeviceAuth: true });",
    "fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));",
    "fs.chmodSync(cfgPath, 0o600);",
  ].join(" ");
  const quietBun = q ? " 2>/dev/null" : "";
  const controlUiMergeResult = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(
      "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; " +
        `bun -e ${shellQuote(controlUiMerge)}${quietBun}`,
    ),
  );
  if (!controlUiMergeResult.ok) {
    logWarn("Could not merge gateway.controlUi bypass flags — Control UI may require manual token/device setup");
  }

  // Configure Telegram channel if a bot token was provided.
  // Write the full channel object atomically via a bun script that reads the
  // existing config, deep-merges the telegram block, and writes it back.
  // Individual `openclaw config set` calls created malformed nested structures
  // that prevented the bot from polling — see #2655.
  if (telegramBotToken) {
    const telegramConfig = JSON.stringify({
      enabled: true,
      botToken: telegramBotToken,
      dmPolicy: "pairing",
      groupPolicy: "open",
      groups: {
        "*": {
          requireMention: true,
        },
      },
    });
    const mergeScript = [
      "import fs from 'fs';",
      "const p = process.env.HOME + '/.openclaw/openclaw.json';",
      "const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));",
      "if (!cfg.channels) cfg.channels = {};",
      "Object.assign(cfg.channels.telegram || (cfg.channels.telegram = {}), JSON.parse(process.env.TELEGRAM_CONFIG));",
      "fs.writeFileSync(p, JSON.stringify(cfg, null, 2));",
      "fs.chmodSync(p, 0o600);",
    ].join(" ");
    const telegramResult = await asyncTryCatchIf(isOperationalError, () =>
      runner.runServer(
        "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; " +
          `export TELEGRAM_CONFIG=${shellQuote(telegramConfig)}; ` +
          `bun -e ${shellQuote(mergeScript)}${quietBun}`,
      ),
    );
    if (telegramResult.ok) {
      logInfo("Telegram bot token configured");
    } else {
      logWarn("Telegram config failed (non-fatal)");
    }
  }

  // Write USER.md bootstrap file
  const messagingLines: string[] = [];
  if (enabledSteps?.has("telegram")) {
    messagingLines.push(
      "",
      "## Messaging Channels",
      "",
      "- **Telegram**: If a bot token was provided, it is already configured.",
      "  To verify: `openclaw config get channels.telegram.botToken`",
      "",
    );
  }

  const userMd = [
    "# User",
    "",
    "## Web Dashboard",
    "",
    "This machine has a web dashboard running on port 18789.",
    "When helping the user set up channels that require QR code scanning",
    "(WhatsApp, Telegram, etc.), always guide them to use the web dashboard",
    "instead of the TUI — QR codes cannot be scanned from a terminal.",
    "",
    "The dashboard URL is: http://127.0.0.1:18789",
    "(It may also be SSH-tunneled to the user's local machine automatically.)",
    ...messagingLines,
    "",
  ].join("\n");
  // Workspace dir is created by `openclaw onboard`; ensure it exists for the fallback path.
  await runner.runServer("mkdir -p ~/.openclaw/workspace");
  await uploadConfigFile(runner, userMd, "$HOME/.openclaw/workspace/USER.md");

  // Wait for OpenClaw bootstrap to complete before opening the dashboard.
  // Without this, the Control UI opens but chat fails with "No session found"
  // because the initial session hasn't been created yet (bootstrapPending: true).
  await waitForOpenclawBootstrap(runner);
}

export async function startGateway(runner: CloudRunner): Promise<void> {
  logStep("Starting OpenClaw gateway daemon...");

  // On Linux with systemd: install a supervised service (Restart=always) +
  // hourly cron heartbeat as a belt-and-suspenders backup.
  // On macOS/other: fall back to setsid/nohup (unsupervised).
  // Base64-encode files to avoid heredoc/quoting issues across cloud SSH.

  // Port check: ss is available on all modern Linux; /dev/tcp works on macOS/some bash.
  // Debian/Ubuntu bash is compiled WITHOUT /dev/tcp support, so we must not rely on it alone.
  const portCheck =
    'ss -tln 2>/dev/null | grep -q ":18789 " || ' +
    "(echo >/dev/tcp/127.0.0.1/18789) 2>/dev/null || " +
    "nc -z 127.0.0.1 18789 2>/dev/null";

  const wrapperScript = [
    "#!/bin/bash",
    'source "$HOME/.agentsearc" 2>/dev/null',
    'export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"',
    "while true; do",
    "  openclaw gateway",
    '  echo "openclaw gateway exited, restarting in 5s" >> /tmp/openclaw-gateway.log',
    "  sleep 5",
    "done",
  ].join("\n");

  // __USER__ and __HOME__ are sed-substituted at deploy time
  const unitFile = [
    "[Unit]",
    "Description=OpenClaw Gateway",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/openclaw-gateway-wrapper",
    "Restart=always",
    "RestartSec=5",
    "User=__USER__",
    "Environment=HOME=__HOME__",
    "StandardOutput=append:/tmp/openclaw-gateway.log",
    "StandardError=append:/tmp/openclaw-gateway.log",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  validateScriptTemplate(wrapperScript, "gateway-wrapper");
  validateScriptTemplate(unitFile, "gateway-unit");

  const wrapperB64 = Buffer.from(wrapperScript).toString("base64");
  const unitB64 = Buffer.from(unitFile).toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(wrapperB64)) {
    throw new Error("Unexpected characters in base64 output");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(unitB64)) {
    throw new Error("Unexpected characters in base64 output");
  }

  const script = [
    "source ~/.agentsearc 2>/dev/null",
    "export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH",
    "printf '%s' '" + wrapperB64 + "' | base64 -d > /tmp/openclaw-gateway-wrapper.tmp",
    "chmod +x /tmp/openclaw-gateway-wrapper.tmp",
    "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then",
    '  _sudo=""',
    '  [ "$(id -u)" != "0" ] && _sudo="sudo"',
    "  $_sudo mv /tmp/openclaw-gateway-wrapper.tmp /usr/local/bin/openclaw-gateway-wrapper",
    "  printf '%s' '" + unitB64 + "' | base64 -d > /tmp/openclaw-gateway.unit.tmp",
    '  sed -i "s|__USER__|$(whoami)|;s|__HOME__|$HOME|" /tmp/openclaw-gateway.unit.tmp',
    "  $_sudo mv /tmp/openclaw-gateway.unit.tmp /etc/systemd/system/openclaw-gateway.service",
    "  $_sudo systemctl daemon-reload",
    "  $_sudo systemctl enable openclaw-gateway 2>/dev/null",
    "  $_sudo systemctl restart openclaw-gateway",
    '  _cron_restart="systemctl restart openclaw-gateway"',
    '  [ "$(id -u)" != "0" ] && _cron_restart="sudo systemctl restart openclaw-gateway"',
    '  (crontab -l 2>/dev/null | grep -v openclaw-gateway; echo "0 * * * * nc -z 127.0.0.1 18789 2>/dev/null || $_cron_restart >> /tmp/openclaw-gateway.log 2>&1") | crontab - 2>/dev/null || true',
    "else",
    "  mv /tmp/openclaw-gateway-wrapper.tmp /tmp/openclaw-gateway-wrapper",
    "  # Always restart — marketplace images often leave an old gateway on :18789 with stale config",
    `  command -v fuser >/dev/null 2>&1 && fuser -k 18789/tcp 2>/dev/null || true`,
    "  pkill -f '[o]penclaw gateway' 2>/dev/null || true",
    "  sleep 2",
    "  if command -v setsid >/dev/null 2>&1; then setsid /tmp/openclaw-gateway-wrapper > /tmp/openclaw-gateway.log 2>&1 < /dev/null &",
    "  else nohup /tmp/openclaw-gateway-wrapper > /tmp/openclaw-gateway.log 2>&1 < /dev/null & fi",
    "fi",
    "elapsed=0; while [ $elapsed -lt 300 ]; do",
    `  if ${portCheck}; then echo "Gateway ready after $elapsed sec"; exit 0; fi`,
    "  printf '.'; sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Gateway failed to start after 300s"; tail -20 /tmp/openclaw-gateway.log 2>/dev/null; exit 1',
  ].join("\n");
  await runner.runServer(script);
  logInfo("OpenClaw gateway started");
}

// ─── Hermes Web Dashboard ────────────────────────────────────────────────────

/**
 * Hermes v0.14+ reads model/provider from ~/.hermes/config.yaml (not ~/.agentsearc OPENAI_*).
 * Without this, install defaults to provider:auto → OpenRouter + claude-opus-4.6.
 */
async function setupHermesConfig(runner: CloudRunner, apiKey: string, modelId?: string): Promise<void> {
  logStep("Configuring Hermes Agent for The Grid...");

  const selectedModel =
    typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())
      ? modelId.trim()
      : GRID_INFERENCE_DEFAULT_MODEL_ID;

  const modelYaml =
    /^[a-zA-Z0-9._-]+$/.test(selectedModel) ? selectedModel : `"${selectedModel.replace(/"/g, '\\"')}"`;

  const configYaml = [
    "model:",
    `  default: ${modelYaml}`,
    "  provider: custom",
    `  base_url: ${HERMES_LITELLM_BASE_URL}`,
  ].join("\n");

  const upstreamModel = selectedModel.includes("/") ? selectedModel : `openai/${selectedModel}`;
  const inferenceBase = resolveGridInferenceApiBase();
  const litellmConfig = `model_list:
  - model_name: "${selectedModel}"
    litellm_params:
      model: "${upstreamModel}"
      api_base: "${inferenceBase}"
      api_key: "os.environ/THEGRID_API_KEY"
      use_chat_completions_api: true
      drop_params: true

litellm_settings:
  drop_params: true
`;

  const hermesEnv = [
    `OPENAI_API_KEY=${shellQuote(apiKey)}`,
    `THEGRID_API_KEY=${shellQuote(apiKey)}`,
  ].join("\n");

  await runner.runServer("mkdir -p ~/.hermes");
  await uploadConfigFile(runner, `${configYaml}\n`, "$HOME/.hermes/config.yaml");
  await uploadConfigFile(runner, `${litellmConfig}\n`, "$HOME/.hermes/litellm.yaml");
  await uploadConfigFile(runner, `${hermesEnv}\n`, "$HOME/.hermes/.env");
  await runner.runServer("chmod 600 ~/.hermes/config.yaml ~/.hermes/litellm.yaml ~/.hermes/.env");

  logStep("Installing Hermes LiteLLM proxy (python3-venv + litellm)...");
  const venvResult = await asyncTryCatch(() =>
    runner.runServer(LITELLM_VENV_SETUP, 300),
  );
  if (!venvResult.ok) {
    throw new Error(
      "Hermes LiteLLM install failed — ensure python3-venv is available on the VM (see provisioning logs)",
    );
  }

  logInfo(
    `Hermes Agent configured (model: ${selectedModel}, provider: custom → local LiteLLM → The Grid)`,
  );
}

/**
 * Pi reads providers/models from ~/.pi/agent/models.json (not THEGRID_API_KEY alone).
 * Without this, Pi shows "No models available" and "No API key found for the selected model".
 */
async function setupPiConfig(runner: CloudRunner, _apiKey: string, modelId?: string): Promise<void> {
  logStep("Configuring Pi for The Grid...");

  const selectedModel =
    typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())
      ? modelId.trim()
      : GRID_INFERENCE_DEFAULT_MODEL_ID;

  const modelsJson = {
    providers: {
      [OPENCLAW_GRID_PROVIDER_ID]: {
        baseUrl: resolveGridInferenceApiBase(),
        api: "openai-completions",
        apiKey: "THEGRID_API_KEY",
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
        models: [
          {
            id: selectedModel,
            name: `The Grid (${selectedModel})`,
          },
        ],
      },
    },
  };

  const settingsJson = {
    defaultProvider: OPENCLAW_GRID_PROVIDER_ID,
    defaultModel: selectedModel,
  };

  await runner.runServer("mkdir -p ~/.pi/agent");
  await uploadConfigFile(runner, `${JSON.stringify(modelsJson, null, 2)}\n`, "$HOME/.pi/agent/models.json");
  await uploadConfigFile(runner, `${JSON.stringify(settingsJson, null, 2)}\n`, "$HOME/.pi/agent/settings.json");
  await runner.runServer("chmod 600 ~/.pi/agent/models.json ~/.pi/agent/settings.json");

  logInfo(`Pi configured (provider: ${OPENCLAW_GRID_PROVIDER_ID}, model: ${selectedModel})`);
}

/**
 * OpenCode resolves models from ~/.config/opencode/opencode.json. Without a
 * custom provider it falls back to its built-in providers and routes the Grid
 * key to the wrong endpoint, surfacing "Forbidden: blocked by a gateway or
 * proxy" (issue #21). We register an OpenAI-compatible provider pointed at The
 * Grid's inference base and select it as the default model so headless prompt
 * runs work out of the box. The key is read from THEGRID_API_KEY via OpenCode's
 * `{env:...}` interpolation (set in ~/.agentsearc), so it never lands on disk.
 */
async function setupOpenCodeConfig(runner: CloudRunner, modelId?: string): Promise<void> {
  logStep("Configuring OpenCode for The Grid...");

  const selectedModel =
    typeof modelId === "string" && modelId.trim() && validateModelId(modelId.trim())
      ? modelId.trim()
      : GRID_INFERENCE_DEFAULT_MODEL_ID;

  const config = {
    $schema: "https://opencode.ai/config.json",
    model: `${OPENCLAW_GRID_PROVIDER_ID}/${selectedModel}`,
    provider: {
      [OPENCLAW_GRID_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "The Grid",
        options: {
          baseURL: resolveGridInferenceApiBase(),
          apiKey: "{env:THEGRID_API_KEY}",
        },
        models: {
          [selectedModel]: {
            name: `The Grid (${selectedModel})`,
          },
        },
      },
    },
  };

  await runner.runServer("mkdir -p ~/.config/opencode");
  await uploadConfigFile(runner, `${JSON.stringify(config, null, 2)}\n`, "$HOME/.config/opencode/opencode.json");
  await runner.runServer("chmod 600 ~/.config/opencode/opencode.json");

  logInfo(`OpenCode configured (provider: ${OPENCLAW_GRID_PROVIDER_ID}, model: ${selectedModel})`);
}

/**
 * Local-mode launch for a LiteLLM-style proxy.
 *
 * Installs the wrapper into ~/.local/bin, launches it via runner.startService
 * (a process detached from the ephemeral command shell — see CloudRunner.
 * startService), then polls its health endpoint from a plain foreground shell.
 *
 * This replaces the `setsid … &` fire-and-forget used on VMs: inside the local
 * runner's `Bun.spawn`-ed shell, a backgrounded job is killed (SIGTERM) when the
 * shell is reaped, so the proxy would never persist. Only used when
 * `runner.startService` is defined (local mode); VM/SSH runners keep the
 * systemd/`setsid` path.
 */
export async function startLiteLlmProxyLocally(
  runner: CloudRunner,
  opts: {
    name: string;
    port: number;
    binName: string;
    logPath: string;
    healthCheck: string;
    prepLines: string[];
  },
): Promise<void> {
  const { name, port, binName, logPath, healthCheck, prepLines } = opts;
  if (!runner.startService) {
    throw new Error("startLiteLlmProxyLocally requires a runner with startService");
  }

  const prep = [
    ...prepLines,
    'mkdir -p "$HOME/.local/bin"',
    `mv /tmp/${binName}.tmp "$HOME/.local/bin/${binName}"`,
    // Clear any proxy left over from a previous session before relaunching.
    //
    // CRITICAL: kill by listening socket, NOT `pkill -f <pattern>`. runLocal
    // executes this via `bash -c "<entire script>"`, so the whole script — which
    // mentions "litellm" and the port — is in the shell's own argv. A
    // `pkill -f '…litellm…<port>…'` therefore matches and SIGTERMs THIS shell
    // (exit 143), which is exactly why local setup kept dying. lsof/fuser match
    // by socket, never by command line.
    `_oldpid=$(lsof -ti tcp:${port} 2>/dev/null); [ -z "$_oldpid" ] && _oldpid=$(fuser ${port}/tcp 2>/dev/null); [ -n "$_oldpid" ] && kill $_oldpid 2>/dev/null || true`,
    "sleep 1",
  ].join("\n");

  const prepResult = await asyncTryCatch(() => runner.runServer(prep, 300));
  if (!prepResult.ok) {
    throw new Error(`${name} LiteLLM proxy setup failed — check ${logPath}`);
  }

  await runner.startService(`exec "$HOME/.local/bin/${binName}"`, logPath);

  const poll = [
    "elapsed=0; while [ $elapsed -lt 120 ]; do",
    `  if ${healthCheck}; then echo "${name} proxy ready after $elapsed sec"; exit 0; fi`,
    "  sleep 1; elapsed=$((elapsed + 1))",
    "done",
    `echo "${name} proxy failed to start within 120s" >&2`,
    `tail -60 ${logPath} 2>/dev/null || true`,
    "exit 1",
  ].join("\n");

  const pollResult = await asyncTryCatch(() => runner.runServer(poll, 130));
  if (pollResult.ok) {
    logInfo(`${name} proxy started on :${port}`);
    return;
  }
  throw new Error(`${name} LiteLLM proxy failed to start on :${port} — check ${logPath}`);
}

async function startHermesLiteLlmProxy(runner: CloudRunner): Promise<void> {
  logStep("Starting Hermes local chat/completions proxy...");

  const wrapperScript = [
    "#!/bin/bash",
    'source "$HOME/.agentsearc" 2>/dev/null',
    'export PATH="$HOME/.local/bin:$HOME/.litellm-venv/bin:$PATH"',
    "export THEGRID_API_KEY",
    `exec "$HOME/.litellm-venv/bin/litellm" --config "$HOME/.hermes/litellm.yaml" --host 127.0.0.1 --port ${HERMES_LITELLM_PORT}`,
  ].join("\n");

  const unitFile = [
    "[Unit]",
    "Description=Hermes LiteLLM proxy for The Grid",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/hermes-litellm-wrapper",
    "Restart=always",
    "RestartSec=3",
    "User=__USER__",
    "Environment=HOME=__HOME__",
    "StandardOutput=append:/tmp/hermes-litellm.log",
    "StandardError=append:/tmp/hermes-litellm.log",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  validateScriptTemplate(wrapperScript, "hermes-litellm-wrapper");
  validateScriptTemplate(unitFile, "hermes-litellm-unit");

  const wrapperB64 = Buffer.from(wrapperScript).toString("base64");
  const unitB64 = Buffer.from(unitFile).toString("base64");

  const checkLines = [
    "source ~/.agentsearc 2>/dev/null",
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.litellm-venv/bin:$PATH"',
    'test -n "$THEGRID_API_KEY" || { echo "THEGRID_API_KEY missing from ~/.agentsearc" >&2; exit 1; }',
    "export THEGRID_API_KEY",
    'test -s "$HOME/.hermes/litellm.yaml" || { echo "Missing ~/.hermes/litellm.yaml" >&2; exit 1; }',
  ];
  const venvWrapperLines = [
    LITELLM_VENV_SETUP,
    'test -x "$HOME/.litellm-venv/bin/litellm" || { echo "litellm binary missing after venv setup" >&2; exit 1; }',
    "printf '%s' '" + wrapperB64 + "' | base64 -d > /tmp/hermes-litellm-wrapper.tmp",
    "chmod +x /tmp/hermes-litellm-wrapper.tmp",
  ];

  // Local mode: launch detached via runner.startService instead of the
  // in-shell `setsid … &`, which Bun tears down (see startLiteLlmProxyLocally).
  if (runner.startService) {
    await startLiteLlmProxyLocally(runner, {
      name: "Hermes",
      port: HERMES_LITELLM_PORT,
      binName: "hermes-litellm-wrapper",
      logPath: "/tmp/hermes-litellm.log",
      healthCheck: HERMES_LITELLM_HEALTH_CHECK,
      prepLines: [...checkLines, ...venvWrapperLines],
    });
    return;
  }

  const script = [
    ...checkLines,
    `if ${HERMES_LITELLM_HEALTH_CHECK}; then echo "Hermes proxy already running on :${HERMES_LITELLM_PORT}"; exit 0; fi`,
    ...venvWrapperLines,
    "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then",
    '  _sudo=""',
    '  [ "$(id -u)" != "0" ] && _sudo="sudo"',
    "  $_sudo mv /tmp/hermes-litellm-wrapper.tmp /usr/local/bin/hermes-litellm-wrapper",
    "  printf '%s' '" + unitB64 + "' | base64 -d > /tmp/hermes-litellm.unit.tmp",
    '  sed -i "s|__USER__|$(whoami)|;s|__HOME__|$HOME|" /tmp/hermes-litellm.unit.tmp',
    "  $_sudo mv /tmp/hermes-litellm.unit.tmp /etc/systemd/system/hermes-litellm.service",
    "  $_sudo systemctl daemon-reload",
    "  $_sudo systemctl enable hermes-litellm 2>/dev/null",
    "  $_sudo systemctl restart hermes-litellm",
    "else",
    // No systemd (e.g. macOS local runs): /usr/local/bin is not user-writable
    // and we have no sudo here, so install the wrapper into the user-owned
    // ~/.local/bin (already on PATH above) instead.
    '  mkdir -p "$HOME/.local/bin"',
    '  mv /tmp/hermes-litellm-wrapper.tmp "$HOME/.local/bin/hermes-litellm-wrapper"',
    "  pkill -f '[l]itellm.*4142' 2>/dev/null || true",
    "  sleep 1",
    "  if command -v setsid >/dev/null 2>&1; then",
    '    setsid "$HOME/.local/bin/hermes-litellm-wrapper" >> /tmp/hermes-litellm.log 2>&1 < /dev/null &',
    "  else",
    '    nohup "$HOME/.local/bin/hermes-litellm-wrapper" >> /tmp/hermes-litellm.log 2>&1 < /dev/null &',
    "  fi",
    "fi",
    "elapsed=0; while [ $elapsed -lt 120 ]; do",
    `  if ${HERMES_LITELLM_HEALTH_CHECK}; then echo "Hermes proxy ready after $elapsed sec"; exit 0; fi`,
    "  sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Hermes proxy failed to start within 120s" >&2',
    "if command -v systemctl >/dev/null 2>&1; then systemctl status hermes-litellm --no-pager 2>/dev/null || true; fi",
    "tail -60 /tmp/hermes-litellm.log 2>/dev/null || true",
    "exit 1",
  ].join("\n");

  const result = await asyncTryCatch(() => runner.runServer(script, 300));
  if (result.ok) {
    logInfo(`Hermes proxy started on :${HERMES_LITELLM_PORT}`);
    return;
  }
  throw new Error(
    `Hermes LiteLLM proxy failed to start on :${HERMES_LITELLM_PORT} — check /tmp/hermes-litellm.log on the VM`,
  );
}

/**
 * Start the Hermes Agent web dashboard as a session-scoped background process.
 *
 * Unlike OpenClaw's gateway (long-running, supervised by systemd), the Hermes
 * dashboard only needs to live for the duration of the agentsea session — the
 * user's TUI in the foreground, dashboard reachable via SSH tunnel in the
 * background. A simple setsid/nohup launch is sufficient; no systemd unit.
 *
 * The dashboard binds to 127.0.0.1:9119 by default (see `hermes dashboard` in
 * hermes-agent/hermes_cli/main.py) and self-authenticates via a session token
 * injected into the SPA HTML, so no token needs to be appended to the tunnel
 * URL.
 */
export async function startHermesDashboard(runner: CloudRunner): Promise<void> {
  logStep("Starting Hermes web dashboard...");

  // Port check — same pattern as startGateway. Debian/Ubuntu bash is compiled
  // without /dev/tcp, so we chain ss → /dev/tcp → nc.
  const portCheck =
    'ss -tln 2>/dev/null | grep -q ":9119 " || ' +
    "(echo >/dev/tcp/127.0.0.1/9119) 2>/dev/null || " +
    "nc -z 127.0.0.1 9119 2>/dev/null";

  // `hermes` lives inside the install venv; mirror launchCmd's PATH exactly.
  const hermesPath = 'export PATH="$HOME/.local/bin:$HOME/.hermes/hermes-agent/venv/bin:$PATH"';

  const script = [
    "source ~/.agentsearc 2>/dev/null",
    hermesPath,
    `if ${portCheck}; then echo "Hermes dashboard already running on :9119"; exit 0; fi`,
    "_hermes_bin=$(command -v hermes) || { echo 'hermes not found in PATH' >&2; exit 1; }",
    // --no-open: we're on a remote VM, don't try to agentsea a browser there.
    // --host 127.0.0.1: loopback-only; the SSH tunnel is how the user reaches it.
    "if command -v setsid >/dev/null 2>&1; then",
    '  setsid "$_hermes_bin" dashboard --port 9119 --host 127.0.0.1 --no-open > /tmp/hermes-dashboard.log 2>&1 < /dev/null &',
    "else",
    '  nohup "$_hermes_bin" dashboard --port 9119 --host 127.0.0.1 --no-open > /tmp/hermes-dashboard.log 2>&1 < /dev/null &',
    "fi",
    "elapsed=0; while [ $elapsed -lt 60 ]; do",
    `  if ${portCheck}; then echo "Hermes dashboard ready after \${elapsed}s"; exit 0; fi`,
    "  printf '.'; sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Hermes dashboard failed to start within 60s" >&2',
    "tail -20 /tmp/hermes-dashboard.log 2>/dev/null || true",
    "exit 1",
  ].join("\n");

  const result = await asyncTryCatch(() => runner.runServer(script));
  if (result.ok) {
    logInfo("Hermes web dashboard started on :9119");
  } else {
    // Non-fatal: the TUI still works even if the dashboard didn't come up.
    logWarn("Hermes web dashboard failed to start — TUI still available");
  }
}

// ─── OpenCode Install Command ────────────────────────────────────────────────

function openCodeInstallCmd(): string {
  // Use $VAR not ${VAR} in the release URL: setupAutoUpdate() embeds this in a
  // systemd-friendly template that rejects "${" (defense against JS interpolation).
  return 'OC_ARCH=$(uname -m); case "$OC_ARCH" in aarch64) OC_ARCH=arm64;; x86_64) OC_ARCH=x64;; esac; OC_OS=$(uname -s | tr A-Z a-z); mkdir -p /tmp/opencode-install "$HOME/.opencode/bin" && curl --proto \'=https\' -fsSL -o /tmp/opencode-install/oc.tar.gz "https://github.com/sst/opencode/releases/latest/download/opencode-$OC_OS-$OC_ARCH.tar.gz" && if tar -tzf /tmp/opencode-install/oc.tar.gz | grep -qE \'(^/|\\.\\.)\'; then echo "Tarball contains unsafe paths" >&2; exit 1; fi && tar xzf /tmp/opencode-install/oc.tar.gz -C /tmp/opencode-install && mv /tmp/opencode-install/opencode "$HOME/.opencode/bin/" && rm -rf /tmp/opencode-install && for _rc in "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile"; do grep -q ".opencode/bin" "$_rc" 2>/dev/null || echo \'export PATH="$HOME/.opencode/bin:$PATH"\' >> "$_rc"; done; { [ ! -f "$HOME/.zshrc" ] || grep -q ".opencode/bin" "$HOME/.zshrc" 2>/dev/null || echo \'export PATH="$HOME/.opencode/bin:$PATH"\' >> "$HOME/.zshrc"; }; export PATH="$HOME/.opencode/bin:$PATH"';
}

// ─── npm prefix helper ────────────────────────────────────────────────────────

/**
 * Shell snippet that detects whether npm's global bin is in PATH.
 * Sets _NPM_G_FLAGS to "--prefix ~/.npm-global" when npm's global bin dir
 * is NOT reachable from PATH (e.g. Sprite VMs where node is under
 * /.sprite/languages/node/nvm/... but that bin dir isn't in PATH).
 *
 * IMPORTANT: We use --prefix per-command instead of `npm config set prefix`
 * because writing .npmrc with a prefix conflicts with nvm (even when nvm
 * isn't loaded, npm from an nvm install detects .npmrc prefix and errors).
 */
const NPM_PREFIX_SETUP =
  '_NPM_G_FLAGS=""; ' +
  '_npm_gbin="$(npm prefix -g 2>/dev/null || echo /usr/local)/bin"; ' +
  'if ! [ -w "$(npm prefix -g 2>/dev/null || echo /usr/local)" ] || ' +
  '! printf "%s" ":${PATH}:" | grep -qF ":${_npm_gbin}:"; then ' +
  'mkdir -p ~/.npm-global/bin; _NPM_G_FLAGS="--prefix $HOME/.npm-global"; fi; ' +
  'export PATH="$HOME/.npm-global/bin:$PATH"; ' +
  // Force IPv4 DNS resolution to avoid IPv6 connectivity failures on some clouds
  // (e.g. Sprite VMs with flaky IPv6 routing to the npm registry)
  'export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"';

/**
 * Validator-safe npm setup for base64-encoded helper scripts.
 *
 * setupAutoUpdate() rejects `${...}` inside encoded script templates, so the
 * auto-update path needs a shell snippet that avoids brace expansion while
 * still preserving the same prefix and PATH behavior as installs.
 */
const NPM_AUTO_UPDATE_SETUP =
  '_NPM_G_FLAGS=""; ' +
  '_npm_prefix="$(npm prefix -g 2>/dev/null || echo /usr/local)"; ' +
  '_npm_gbin="$_npm_prefix/bin"; ' +
  'if ! [ -w "$_npm_prefix" ] || ! printf "%s" ":$PATH:" | grep -qF ":$_npm_gbin:"; then ' +
  'mkdir -p "$HOME/.npm-global/bin"; _NPM_G_FLAGS="--prefix $HOME/.npm-global"; fi; ' +
  'export PATH="$HOME/.npm-global/bin:$PATH"; ' +
  'case " $NODE_OPTIONS " in *" --dns-result-order=ipv4first "*) ;; *) export NODE_OPTIONS="$NODE_OPTIONS --dns-result-order=ipv4first" ;; esac';

/**
 * Shell snippet that persists ~/.npm-global/bin in PATH across all shell config
 * files: ~/.bashrc, ~/.profile, ~/.bash_profile, and ~/.zshrc.
 * Login shells (SSH reconnect) source ~/.profile or ~/.bash_profile, not ~/.bashrc,
 * so writing to ~/.bashrc alone is insufficient.
 */
const NPM_GLOBAL_PATH_PERSIST =
  "for _rc in ~/.bashrc ~/.profile ~/.bash_profile; do " +
  "grep -qF '.npm-global/bin' \"$_rc\" 2>/dev/null || " +
  'echo \'export PATH="$HOME/.npm-global/bin:$PATH"\' >> "$_rc"; done; ' +
  "{ [ ! -f ~/.zshrc ] || grep -qF '.npm-global/bin' ~/.zshrc 2>/dev/null || " +
  "echo 'export PATH=\"$HOME/.npm-global/bin:$PATH\"' >> ~/.zshrc; }";

/**
 * Shell snippet that verifies the kilocode binary is actually available after
 * npm install. @kilocode/cli v7+ uses a postinstall script that downloads a
 * native binary. On some clouds (notably GCP with cloudInitTier "node"), the
 * postinstall can fail silently, leaving the bin symlink pointing to a JS
 * wrapper but no actual native binary to exec.
 *
 * This snippet:
 * 1. Checks if `kilocode` is already working
 * 2. If not, finds the npm package dir and re-runs the postinstall
 * 3. If still not found, searches for the native binary in the package dir
 *    and symlinks it into a PATH-accessible location
 */
const KILOCODE_BINARY_VERIFY =
  "{ " +
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  // Quick check: if kilocode already works, nothing to do
  "if command -v kilocode >/dev/null 2>&1 && kilocode --version >/dev/null 2>&1; then exit 0; fi; " +
  // Find the npm package directory (works with both --prefix and default installs)
  '_kc_pkg="$(npm prefix -g 2>/dev/null)/lib/node_modules/@kilocode/cli"; ' +
  '[ -d "$_kc_pkg" ] || _kc_pkg="$HOME/.npm-global/lib/node_modules/@kilocode/cli"; ' +
  'if [ -d "$_kc_pkg" ]; then ' +
  // Re-run the postinstall script explicitly
  // cd ~ first to avoid "current working directory was deleted" errors in bun/node
  'echo "==> kilocode binary not found, re-running postinstall..."; ' +
  'cd ~ && cd "$_kc_pkg" && npm run postinstall 2>/dev/null || true; ' +
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  "if command -v kilocode >/dev/null 2>&1 && kilocode --version >/dev/null 2>&1; then exit 0; fi; " +
  // Postinstall re-run didn't help — search for native binary in the package
  'echo "==> Searching for kilocode binary in package directory..."; ' +
  '_kc_bin="$(find "$_kc_pkg" -name "kilocode*" -type f -perm /111 2>/dev/null | head -1)"; ' +
  'if [ -n "$_kc_bin" ]; then ' +
  '_kc_dest="$(npm prefix -g 2>/dev/null || echo /usr/local)/bin/kilocode"; ' +
  '[ -w "$(dirname "$_kc_dest")" ] || _kc_dest="$HOME/.npm-global/bin/kilocode"; ' +
  'mkdir -p "$(dirname "$_kc_dest")"; ' +
  'ln -sf "$_kc_bin" "$_kc_dest"; ' +
  'echo "==> Linked kilocode binary: $_kc_bin -> $_kc_dest"; ' +
  "fi; " +
  "fi; " +
  // Final check
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  "command -v kilocode >/dev/null 2>&1 || " +
  '{ echo "WARNING: kilocode binary still not found after recovery attempts"; }; ' +
  "}";

/**
 * Shell snippet that verifies the junie binary is actually available after
 * npm install. @jetbrains/junie-cli uses a postinstall script that downloads a
 * native binary. On some clouds (notably Sprite with flaky IPv6 routing), the
 * postinstall can fail, leaving bin/index.js present but the native binary absent.
 *
 * This snippet:
 * 1. Checks if `junie` is already working
 * 2. If not, finds the npm package dir and re-runs the postinstall
 * 3. Warns if still not found after recovery
 */
const JUNIE_BINARY_VERIFY =
  "{ " +
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  // Quick check: if junie already works, nothing to do
  "if command -v junie >/dev/null 2>&1 && junie --version >/dev/null 2>&1; then exit 0; fi; " +
  // Find the npm package directory
  '_jn_pkg="$(npm prefix -g 2>/dev/null)/lib/node_modules/@jetbrains/junie-cli"; ' +
  '[ -d "$_jn_pkg" ] || _jn_pkg="$HOME/.npm-global/lib/node_modules/@jetbrains/junie-cli"; ' +
  'if [ -d "$_jn_pkg" ]; then ' +
  // Re-run the postinstall script explicitly
  // cd ~ first to avoid "current working directory was deleted" errors in bun/node
  'echo "==> junie binary not found, re-running postinstall..."; ' +
  'cd ~ && cd "$_jn_pkg" && npm run postinstall 2>/dev/null || true; ' +
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  "if command -v junie >/dev/null 2>&1 && junie --version >/dev/null 2>&1; then exit 0; fi; " +
  "fi; " +
  // Final check
  'export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
  "command -v junie >/dev/null 2>&1 || " +
  '{ echo "WARNING: junie binary still not found after recovery attempts"; }; ' +
  "}";

// ─── Auto-Update Service ─────────────────────────────────────────────────────

/**
 * Install a systemd timer + service that periodically updates the agent
 * binary and system packages without disrupting running instances.
 *
 * Safety for running instances:
 * - Binary agents (Go, Rust): Linux keeps old inode in memory; replacement on disk is safe
 * - npm agents: Node.js caches all loaded modules in memory at startup. npm install -g
 *   replaces files on disk via a staging dir. Running processes are unaffected since
 *   CLI agents load everything at startup (no lazy imports after the swap).
 *
 * The new version takes effect on next restart via the existing restart loop.
 * Skipped for local cloud and non-systemd systems.
 */
export async function setupAutoUpdate(runner: CloudRunner, agentName: string, updateCmd: string): Promise<void> {
  logStep("Setting up agent auto-update service...");

  const wrapperScript = [
    "#!/bin/bash",
    "set -eo pipefail",
    'LOGFILE="/var/log/agentsea-auto-update.log"',
    'LOCKFILE="/var/lock/agentsea-auto-update.lock"',
    "",
    'log() { printf "[%s] %s\\n" "$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')" "$*" >> "$LOGFILE"; }',
    "",
    "# Exclusive lock — skip if another update is already running",
    'exec 9>"$LOCKFILE"',
    "if ! flock -n 9; then",
    '  log "Another update is already running, skipping"',
    "  exit 0",
    "fi",
    "",
    '[ -f "$HOME/.agentsearc" ] && source "$HOME/.agentsearc" 2>/dev/null',
    'export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.claude/local/bin:$PATH"',
    "",
    "# ── Phase 1: System package updates ──",
    'log "Updating system packages"',
    "if command -v apt-get >/dev/null 2>&1; then",
    "  _sudo_sys=''",
    '  [ "$(id -u)" != "0" ] && _sudo_sys="sudo"',
    "  export DEBIAN_FRONTEND=noninteractive",
    "  # Disable Ubuntu's unattended-upgrades to avoid dpkg lock contention.",
    "  # We handle all updates here — running both causes lock conflicts.",
    "  if $_sudo_sys systemctl is-active --quiet unattended-upgrades 2>/dev/null; then",
    "    $_sudo_sys systemctl disable --now unattended-upgrades 2>/dev/null || true",
    '    log "Disabled unattended-upgrades (agentsea handles updates)"',
    "  fi",
    "  # Wait up to 5 min for any in-progress dpkg/apt operation to finish",
    '  $_sudo_sys flock -w 300 /var/lib/dpkg/lock-frontend apt-get update -qq >> "$LOGFILE" 2>&1 || log "apt-get update failed (non-fatal)"',
    '  $_sudo_sys flock -w 300 /var/lib/dpkg/lock-frontend apt-get upgrade -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" >> "$LOGFILE" 2>&1 || log "apt-get upgrade failed (non-fatal)"',
    '  $_sudo_sys apt-get autoremove -y -qq >> "$LOGFILE" 2>&1 || true',
    '  log "System packages updated"',
    "fi",
    "",
    "# ── Phase 2: Agent update ──",
    `log "Starting ${agentName} update"`,
    updateCmd + ' >> "$LOGFILE" 2>&1',
    "_exit=$?",
    'if [ "$_exit" -eq 0 ]; then',
    `  log "${agentName} update completed successfully"`,
    "else",
    `  log "${agentName} update failed (exit code $_exit)"`,
    "fi",
    'exit "$_exit"',
  ].join("\n");

  // __USER__ and __HOME__ are sed-substituted at deploy time
  const unitFile = [
    "[Unit]",
    `Description=Agentsea auto-update for ${agentName}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=oneshot",
    "ExecStart=/usr/local/bin/agentsea-auto-update",
    "User=__USER__",
    "Environment=HOME=__HOME__",
    "TimeoutStartSec=1800",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  const timerFile = [
    "[Unit]",
    `Description=Run agentsea auto-update for ${agentName} every 6 hours`,
    "",
    "[Timer]",
    "OnBootSec=15min",
    "OnUnitActiveSec=6h",
    "RandomizedDelaySec=30min",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
  ].join("\n");

  validateScriptTemplate(wrapperScript, "auto-update-wrapper");
  validateScriptTemplate(unitFile, "auto-update-unit");
  validateScriptTemplate(timerFile, "auto-update-timer");

  const wrapperB64 = Buffer.from(wrapperScript).toString("base64");
  const unitB64 = Buffer.from(unitFile).toString("base64");
  const timerB64 = Buffer.from(timerFile).toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(wrapperB64)) {
    throw new Error("Unexpected characters in base64 output");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(unitB64)) {
    throw new Error("Unexpected characters in base64 output");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(timerB64)) {
    throw new Error("Unexpected characters in base64 output");
  }

  const script = [
    "if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then exit 0; fi",
    '_sudo=""',
    '[ "$(id -u)" != "0" ] && _sudo="sudo"',
    "printf '%s' '" + wrapperB64 + "' | base64 -d | $_sudo tee /usr/local/bin/agentsea-auto-update > /dev/null",
    "$_sudo chmod +x /usr/local/bin/agentsea-auto-update",
    "printf '%s' '" + unitB64 + "' | base64 -d > /tmp/agentsea-auto-update.service.tmp",
    'sed -i "s|__USER__|$(whoami)|;s|__HOME__|$HOME|" /tmp/agentsea-auto-update.service.tmp',
    "$_sudo mv /tmp/agentsea-auto-update.service.tmp /etc/systemd/system/agentsea-auto-update.service",
    "printf '%s' '" + timerB64 + "' | base64 -d | $_sudo tee /etc/systemd/system/agentsea-auto-update.timer > /dev/null",
    "$_sudo systemctl daemon-reload",
    "$_sudo systemctl enable agentsea-auto-update.timer 2>/dev/null",
    "$_sudo systemctl start agentsea-auto-update.timer",
  ].join("\n");

  const result = await asyncTryCatch(() => runner.runServer(script));
  if (result.ok) {
    logInfo("Agent auto-update setup completed");
  } else {
    logWarn("Auto-update setup failed (non-fatal, agent still works)");
  }
}

// ─── Security Scan ─────────────────────────────────────────────────────────

/**
 * Install a cron job that runs basic security heuristics every 6 hours.
 * Checks: SSH authorized_keys anomalies, failed login attempts, unexpected
 * packages, and suspicious processes. Findings are written to
 * /var/log/agentsea-security-scan.log so they can be displayed on reconnect.
 *
 * Skipped for local cloud and non-cron systems.
 */
export async function setupSecurityScan(runner: CloudRunner): Promise<void> {
  logStep("Setting up security scan...");

  const scanScript = [
    "#!/bin/bash",
    "set -eo pipefail",
    'LOGFILE="/var/log/agentsea-security-scan.log"',
    'ALERTFILE="/var/log/agentsea-security-alerts.log"',
    "",
    "# Truncate alerts file each run — only latest findings matter",
    '> "$ALERTFILE"',
    "",
    'log() { printf "[%s] %s\\n" "$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')" "$*" >> "$LOGFILE"; }',
    'alert() { printf "[%s] %s\\n" "$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')" "$*" >> "$ALERTFILE"; log "ALERT: $*"; }',
    "",
    'log "Security scan started"',
    "",
    "# ── Check 1: SSH authorized_keys ──",
    "# Count keys across all users. Agentsea injects exactly one key at provision time.",
    "# Multiple keys or keys from unexpected sources are suspicious.",
    "_total_keys=0",
    "_key_alerts=0",
    "for _authfile in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do",
    '  [ -f "$_authfile" ] || continue',
    '  _count=$(grep -c "^ssh-" "$_authfile" 2>/dev/null || echo 0)',
    "  _total_keys=$((_total_keys + _count))",
    '  if [ "$_count" -gt 2 ]; then',
    '    alert "SSH: $_authfile contains $_count keys (expected 1-2)"',
    "    _key_alerts=$((_key_alerts + 1))",
    "  fi",
    "done",
    'if [ "$_total_keys" -eq 0 ]; then',
    '  alert "SSH: No authorized_keys found — server may be inaccessible"',
    "fi",
    'log "SSH key check done: $_total_keys total keys, $_key_alerts alerts"',
    "",
    "# ── Check 2: Failed login attempts ──",
    "# Check auth logs for brute-force indicators.",
    "_fail_count=0",
    "if [ -f /var/log/auth.log ]; then",
    "  _fail_count=$(grep -c 'Failed password\\|authentication failure' /var/log/auth.log 2>/dev/null || echo 0)",
    "elif [ -f /var/log/secure ]; then",
    "  _fail_count=$(grep -c 'Failed password\\|authentication failure' /var/log/secure 2>/dev/null || echo 0)",
    "fi",
    'if [ "$_fail_count" -gt 50 ]; then',
    '  alert "AUTH: $_fail_count failed login attempts detected — possible brute-force"',
    "  # Grab the top offending IPs",
    '  _top_ips=""',
    "  if [ -f /var/log/auth.log ]; then",
    "    _top_ips=$(grep 'Failed password' /var/log/auth.log 2>/dev/null | grep -oE '([0-9]{1,3}\\.){3}[0-9]{1,3}' | sort | uniq -c | sort -rn | head -5)",
    "  elif [ -f /var/log/secure ]; then",
    "    _top_ips=$(grep 'Failed password' /var/log/secure 2>/dev/null | grep -oE '([0-9]{1,3}\\.){3}[0-9]{1,3}' | sort | uniq -c | sort -rn | head -5)",
    "  fi",
    '  if [ -n "$_top_ips" ]; then',
    '    alert "AUTH: Top offending IPs:\\n$_top_ips"',
    "  fi",
    "fi",
    'log "Auth check done: $_fail_count failed attempts"',
    "",
    "# ── Check 3: Unexpected software ──",
    "# Flag known attack tools or unexpected daemons that agentsea never installs.",
    '_suspicious_bins="nmap masscan hydra john hashcat ettercap aircrack-ng metasploit msfconsole msfvenom netcat ncat socat cryptominer xmrig minerd cgminer"',
    "_found_suspicious=0",
    "for _bin in $_suspicious_bins; do",
    '  if command -v "$_bin" >/dev/null 2>&1; then',
    '    alert "SOFTWARE: Unexpected binary found: $_bin ($(command -v "$_bin"))"',
    "    _found_suspicious=$((_found_suspicious + 1))",
    "  fi",
    "done",
    'log "Software check done: $_found_suspicious suspicious binaries"',
    "",
    "# ── Check 4: Suspicious processes ──",
    "# Check for crypto miners or reverse shells.",
    '_sus_procs=$(ps aux 2>/dev/null | grep -iE "xmrig|minerd|cryptonight|stratum\\+|/dev/tcp/|bash -i" | grep -v grep || true)',
    'if [ -n "$_sus_procs" ]; then',
    '  alert "PROCESS: Suspicious processes detected:\\n$_sus_procs"',
    "fi",
    "",
    "# ── Check 4b: High CPU processes (miner signal) ──",
    "# Crypto miners peg CPU at 90-100%. Flag any non-agent process sustaining high usage.",
    "_high_cpu=$(ps aux --no-headers 2>/dev/null | awk '$3 > 80.0 { print }' | grep -vE \"claude|codex|aider|node|bun|deno|python|apt|dpkg|cc1|gcc|g\\+\\+|make|cargo|rustc\" || true)",
    'if [ -n "$_high_cpu" ]; then',
    '  _hcount=$(echo "$_high_cpu" | wc -l | tr -d " ")',
    '  alert "CPU: $_hcount process(es) using >80%% CPU — possible crypto miner:\\n$_high_cpu"',
    "fi",
    "",
    "# ── Check 4c: Mining pool connections ──",
    "# Miners connect to pools on well-known ports (3333, 4444, 5555, 8333) via stratum.",
    '_pool_conns=$(ss -tnp 2>/dev/null | grep -E ":(3333|4444|5555|8333|14444|45700)\\s" || true)',
    'if [ -n "$_pool_conns" ]; then',
    '  alert "NETWORK: Outbound connections to known mining pool ports detected:\\n$_pool_conns"',
    "fi",
    "",
    "# ── Check 5: Unexpected cron jobs ──",
    "# Look for cron entries not installed by agentsea.",
    "_cron_alerts=0",
    "for _user in $(cut -d: -f1 /etc/passwd 2>/dev/null); do",
    '  _cron=$(crontab -l -u "$_user" 2>/dev/null || true)',
    '  if [ -n "$_cron" ]; then',
    '    _non_agentsea=$(echo "$_cron" | grep -v "^#" | grep -v "agentsea\\|openclaw-gateway" || true)',
    '    if [ -n "$_non_agentsea" ]; then',
    '      _count=$(echo "$_non_agentsea" | wc -l | tr -d " ")',
    '      if [ "$_count" -gt 0 ]; then',
    '        alert "CRON: $_count unexpected cron entries for user $_user"',
    "        _cron_alerts=$((_cron_alerts + 1))",
    "      fi",
    "    fi",
    "  fi",
    "done",
    'log "Cron check done: $_cron_alerts users with unexpected entries"',
    "",
    "# ── Check 6: Listening ports ──",
    "# Flag unexpected listeners (not SSH, not agent dashboards).",
    '_known_ports="22 80 443 8080 8443 18789 3000 5173"',
    "_listeners=$(ss -tlnp 2>/dev/null | tail -n +2 || netstat -tlnp 2>/dev/null | tail -n +2 || true)",
    'if [ -n "$_listeners" ]; then',
    "  _unexpected=$(echo \"$_listeners\" | grep -vE \"($(echo $_known_ports | tr ' ' '|'))\" | grep -v 'sshd\\|node\\|bun\\|deno\\|python' || true)",
    '  if [ -n "$_unexpected" ]; then',
    '    _ucount=$(echo "$_unexpected" | wc -l | tr -d " ")',
    '    alert "NETWORK: $_ucount unexpected listening ports detected"',
    "  fi",
    "fi",
    "",
    'log "Security scan completed"',
  ].join("\n");

  const scanB64 = Buffer.from(scanScript).toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(scanB64)) {
    throw new Error("Unexpected characters in base64 output");
  }

  const cronLine = "0 */6 * * * /usr/local/bin/agentsea-security-scan >> /var/log/agentsea-security-scan.log 2>&1";

  const installScript = [
    "if ! command -v crontab >/dev/null 2>&1; then exit 0; fi",
    '_sudo=""',
    '[ "$(id -u)" != "0" ] && _sudo="sudo"',
    "printf '%s' '" + scanB64 + "' | base64 -d | $_sudo tee /usr/local/bin/agentsea-security-scan > /dev/null",
    "$_sudo chmod +x /usr/local/bin/agentsea-security-scan",
    "$_sudo touch /var/log/agentsea-security-scan.log /var/log/agentsea-security-alerts.log",
    "$_sudo chmod 644 /var/log/agentsea-security-scan.log /var/log/agentsea-security-alerts.log",
    // Add cron entry if not already present
    `(crontab -l 2>/dev/null | grep -v agentsea-security-scan; echo "${cronLine}") | crontab - 2>/dev/null || true`,
    // Run the first scan immediately
    "/usr/local/bin/agentsea-security-scan 2>/dev/null || true",
  ].join("\n");

  const result = await asyncTryCatch(() => runner.runServer(installScript));
  if (result.ok) {
    logInfo("Security scan installed (runs every 6 hours)");
  } else {
    logWarn("Security scan setup failed (non-fatal)");
  }
}

// ─── Default Agent Definitions ───────────────────────────────────────────────

function createAgents(runner: CloudRunner): Record<string, AgentConfig> {
  return {
    claude: {
      name: "Claude Code",
      cloudInitTier: "minimal",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      modelEnvVar: "ANTHROPIC_MODEL",
      preProvision: detectGithubAuth,
      install: () => installClaudeCode(runner),
      // Inference is The Grid only: ANTHROPIC_BASE_URL → Grid Anthropic client base (SDK appends /v1/messages).
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        `ANTHROPIC_BASE_URL=${resolveGridAnthropicMessagesClientBase()}`,
        `ANTHROPIC_MODEL=${GRID_INFERENCE_DEFAULT_MODEL_ID}`,
        `ANTHROPIC_AUTH_TOKEN=${apiKey}`,
        "ANTHROPIC_API_KEY=",
        "CLAUDE_CODE_SKIP_ONBOARDING=1",
        "CLAUDE_CODE_ENABLE_TELEMETRY=0",
      ],
      configure: (apiKey, modelId) => setupClaudeCodeConfig(runner, apiKey, modelId),
      launchCmd: () =>
        'source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.claude/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH; claude --model "$ANTHROPIC_MODEL"',
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.claude/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH; claude --model "$ANTHROPIC_MODEL" -p --dangerously-skip-permissions ${shellQuote(prompt)}`,
      updateCmd:
        'export PATH="$HOME/.claude/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.n/bin:$PATH"; ' +
        "npm install -g @anthropic-ai/claude-code@latest 2>/dev/null || " +
        "curl --proto '=https' -fsSL https://claude.ai/install.sh | bash",
    },

    codex: {
      name: "Codex CLI",
      cloudInitTier: "node",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Codex CLI",
          `${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} @openai/codex && ${NPM_GLOBAL_PATH_PERSIST}`,
        ),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        ...agentsearcGridInferenceExtras(),
        `OPENAI_API_KEY=${apiKey}`,
        `OPENAI_BASE_URL=${resolveGridInferenceApiBase()}`,
      ],
      configure: (_apiKey, modelId, _enabledSteps) => setupCodexConfig(runner, modelId),
      preLaunch: () => startCodexLiteLlmProxy(runner),
      launchCmd: () => "source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; codex",
      // Newer Codex CLIs dropped `--ask-for-approval` from `codex exec` (it errors
      // with "unexpected argument"). Probe `--help` and only pass the flag when the
      // installed binary still accepts it; `--sandbox danger-full-access` already
      // keeps the exec run non-interactive on versions that removed it.
      promptCmd: (prompt) =>
        "source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; " +
        '_cx_flags="--sandbox danger-full-access"; ' +
        "codex exec --help 2>/dev/null | grep -q -- '--ask-for-approval' && _cx_flags=\"$_cx_flags --ask-for-approval=never\"; " +
        `codex exec $_cx_flags ${shellQuote(prompt)} < /dev/null`,
      updateCmd: `${NPM_AUTO_UPDATE_SETUP} && ` + "npm install -g $_NPM_G_FLAGS @openai/codex@latest",
    },

    openclaw: (() => {
      const dashboardToken = crypto.randomUUID().replace(/-/g, "");
      return {
        name: "OpenClaw",
        cloudInitTier: "full" satisfies AgentConfig["cloudInitTier"],
        preProvision: detectGithubAuth,
        modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
        install: async () => {
          await installAgent(
            runner,
            "openclaw",
            `source ~/.bashrc 2>/dev/null; ${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} openclaw && ${NPM_GLOBAL_PATH_PERSIST}`,
          );
        },
        envVars: (apiKey: string) => [
          `THEGRID_API_KEY=${apiKey}`,
          `OPENAI_API_KEY=${apiKey}`,
          `OPENAI_BASE_URL=${resolveGridOpenClawMessagesBase()}`,
        ],
        configure: (apiKey: string, modelId?: string, enabledSteps?: Set<string>) =>
          setupOpenclawConfig(runner, apiKey, modelId || VENDOR_CHAT_MODEL_DEFAULT, dashboardToken, enabledSteps),
        preLaunch: () => startGateway(runner),
        launchCmd: () =>
          "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; openclaw tui",
        promptCmd: (prompt: string) =>
          `source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH; openclaw run ${shellQuote(prompt)}`,
        tunnel: {
          remotePort: 18789,
          logGatewayToken: dashboardToken,
          // Prefer 127.0.0.1 over localhost (OpenClaw docs). Include session + token on `/chat`
          // so route changes cannot drop bootstrap (see openclaw/openclaw#43037).
          browserUrl: (localPort: number) =>
            `http://127.0.0.1:${localPort}/chat?session=${encodeURIComponent(
              OPENCLAW_CONTROL_UI_DEFAULT_CHAT_SESSION,
            )}&token=${encodeURIComponent(dashboardToken)}#token=${dashboardToken}`,
        },
        updateCmd: `${NPM_AUTO_UPDATE_SETUP} && ` + "npm install -g $_NPM_G_FLAGS openclaw@latest",
      };
    })(),

    opencode: {
      name: "OpenCode",
      cloudInitTier: "minimal",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      preProvision: detectGithubAuth,
      install: () => installAgent(runner, "OpenCode", openCodeInstallCmd()),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
      ],
      configure: (_apiKey, modelId) => setupOpenCodeConfig(runner, modelId),
      launchCmd: () => "source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; opencode",
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; opencode --prompt ${shellQuote(prompt)}`,
      updateCmd: openCodeInstallCmd(),
    },

    kilocode: {
      name: "Kilo Code",
      cloudInitTier: "node",
      modelEnvVar: "KILOCODE_MODEL",
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Kilo Code",
          `cd "$HOME" && ${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} @kilocode/cli && ${NPM_GLOBAL_PATH_PERSIST} && ${KILOCODE_BINARY_VERIFY}`,
        ),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        `KILO_PROVIDER_TYPE=${VENDOR_KILO_PROVIDER_TYPE_VALUE}`,
        `KILO_OPEN_ROUTER_API_KEY=${apiKey}`,
      ],
      launchCmd: () => "source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; kilocode",
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; kilocode --prompt ${shellQuote(prompt)}`,
      updateCmd: `${NPM_AUTO_UPDATE_SETUP} && ` + "npm install -g $_NPM_G_FLAGS @kilocode/cli@latest",
    },

    hermes: {
      name: "Hermes Agent",
      cloudInitTier: "minimal",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      modelEnvVar: "LLM_MODEL",
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Hermes Agent",
          // Force git to use HTTPS instead of SSH for GitHub URLs — pip dependencies
          // using git+ssh:// timeout on cloud VMs where outbound SSH is blocked/slow.
          'git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && ' +
            'git config --global url."https://github.com/".insteadOf "git@github.com:" && ' +
            "curl --proto '=https' -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup",
          600,
        ),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        `OPENAI_BASE_URL=${HERMES_LITELLM_BASE_URL}`,
        `OPENAI_API_KEY=${apiKey}`,
        "HERMES_YOLO_MODE=1",
      ],
      configure: async (apiKey, modelId, enabledSteps) => {
        await setupHermesConfig(runner, apiKey, modelId);
        // YOLO mode is on by default (in envVars above). If the user explicitly
        // unchecked it in setup options, remove it from .agentsearc.
        if (enabledSteps && !enabledSteps.has("yolo-mode")) {
          await runner.runServer("sed -i '/HERMES_YOLO_MODE/d' ~/.agentsearc");
          logInfo("YOLO mode disabled — Hermes will prompt before installing tools");
        }
      },
      preLaunch: async () => {
        await startHermesLiteLlmProxy(runner);
        await startHermesDashboard(runner);
      },
      preLaunchMsg:
        "Your Hermes web dashboard will open automatically — use it to configure settings, monitor sessions, and manage gateways.",
      launchCmd: () =>
        "source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.local/bin:$HOME/.hermes/hermes-agent/venv/bin:$PATH; hermes",
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; export PATH=$HOME/.local/bin:$HOME/.hermes/hermes-agent/venv/bin:$PATH; hermes ${shellQuote(prompt)}`,
      tunnel: {
        remotePort: 9119,
        browserUrl: (localPort: number) => `http://localhost:${localPort}/`,
      },
      updateCmd:
        // Same SSH→HTTPS rewrite for auto-update runs
        'git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && ' +
        'git config --global url."https://github.com/".insteadOf "git@github.com:" && ' +
        "curl --proto '=https' -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup",
    },

    junie: {
      name: "Junie",
      cloudInitTier: "node",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Junie",
          `${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} @jetbrains/junie-cli && ${NPM_GLOBAL_PATH_PERSIST} && ${JUNIE_BINARY_VERIFY}`,
        ),
      envVars: (apiKey) => [
        `JUNIE_THEGRID_API_KEY=${apiKey}`,
        `THEGRID_API_KEY=${apiKey}`,
      ],
      configure: (apiKey, modelId) => setupJunieConfig(runner, apiKey, modelId),
      preLaunch: () => startJunieLiteLlmProxy(runner),
      launchCmd: () => `${JUNIE_LAUNCH_SHELL_PREFIX}; junie`,
      promptCmd: (prompt) =>
        `${JUNIE_LAUNCH_SHELL_PREFIX}; junie --prompt ${shellQuote(prompt)}`,
      updateCmd: `${NPM_AUTO_UPDATE_SETUP} && ` + "npm install -g $_NPM_G_FLAGS @jetbrains/junie-cli@latest",
    },

    pi: {
      name: "Pi",
      cloudInitTier: "node",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Pi",
          `cd "$HOME" && ${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} @mariozechner/pi-coding-agent && ${NPM_GLOBAL_PATH_PERSIST}`,
        ),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
      ],
      configure: (apiKey, modelId) => setupPiConfig(runner, apiKey, modelId),
      launchCmd: () => "source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; pi",
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; source ~/.zshrc 2>/dev/null; pi --prompt ${shellQuote(prompt)}`,
      updateCmd: `${NPM_AUTO_UPDATE_SETUP} && ` + "npm install -g $_NPM_G_FLAGS @mariozechner/pi-coding-agent@latest",
    },

    t3code: {
      name: "T3 Code",
      cloudInitTier: "node" satisfies AgentConfig["cloudInitTier"],
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "T3 Code",
          `${NPM_PREFIX_SETUP} && npm install -g \${_NPM_G_FLAGS} t3 @openai/codex && ${NPM_GLOBAL_PATH_PERSIST}`,
        ),
      // T3 Code spawns Codex CLI as its primary provider; child processes inherit Grid auth via .agentsearc.
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        ...agentsearcGridInferenceExtras(),
        `ANTHROPIC_BASE_URL=${resolveGridAnthropicMessagesClientBase()}`,
        `ANTHROPIC_AUTH_TOKEN=${apiKey}`,
        "ANTHROPIC_API_KEY=",
        `OPENAI_API_KEY=${apiKey}`,
        `OPENAI_BASE_URL=${resolveGridInferenceApiBase()}`,
      ],
      configure: (_apiKey, modelId) => setupT3CodeConfig(runner, modelId),
      preLaunch: () => startCodexLiteLlmProxy(runner),
      preLaunchMsg: "T3 Code web GUI will open automatically — use it to interact with Claude Code and Codex agents.",
      launchCmd: () => T3_LAUNCH_CMD,
      tunnel: {
        remotePort: 3773,
        requiresPairing: true,
      },
      updateCmd:
        `${NPM_AUTO_UPDATE_SETUP} && npm install -g $_NPM_G_FLAGS t3@latest @openai/codex@latest`,
    },

    cursor: {
      name: "Cursor CLI",
      cloudInitTier: "bun",
      modelDefault: VENDOR_CHAT_MODEL_DEFAULT,
      modelEnvVar: "GRID_MODEL_ID",
      preProvision: detectGithubAuth,
      install: () =>
        installAgent(
          runner,
          "Cursor CLI",
          "curl https://cursor.com/install -fsS | bash && " +
            'export PATH="$HOME/.local/bin:$PATH" && ' +
            "agent --version",
        ),
      envVars: (apiKey) => [
        `THEGRID_API_KEY=${apiKey}`,
        `CURSOR_API_KEY=${apiKey}`,
      ],
      configure: (_apiKey, modelId) => setupCursorProxy(runner, modelId),
      preLaunch: () => startCursorProxy(runner),
      launchCmd: () =>
        'source ~/.agentsearc 2>/dev/null; export PATH="$HOME/.local/bin:$PATH"; agent --endpoint https://api2.cursor.sh',
      promptCmd: (prompt) =>
        `source ~/.agentsearc 2>/dev/null; export PATH="$HOME/.local/bin:$PATH"; agent --endpoint https://api2.cursor.sh --prompt ${shellQuote(prompt)}`,
      updateCmd: 'export PATH="$HOME/.local/bin:$PATH"; agent update',
    },
  };
}

function resolveAgent(agents: Record<string, AgentConfig>, name: string): AgentConfig {
  const agent = agents[name.toLowerCase()];
  if (!agent) {
    logError(`Unknown agent: ${name}`);
    logError(`Available agents: ${Object.keys(agents).join(", ")}`);
    throw new Error(`Unknown agent: ${name}`);
  }
  return agent;
}

/**
 * Factory that creates agents + resolveAgent for a given CloudRunner.
 * Replaces the identical 16-line boilerplate in each cloud's agents.ts.
 */
export function createCloudAgents(runner: CloudRunner): {
  agents: Record<string, AgentConfig>;
  resolveAgent: (name: string) => AgentConfig;
} {
  const agentMap = createAgents(runner);
  return {
    agents: agentMap,
    resolveAgent: (name: string) => resolveAgent(agentMap, name),
  };
}
