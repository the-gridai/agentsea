// shared/orchestrate.ts — Shared orchestration pipeline for deploying agents
// Each cloud implements CloudOrchestrator and calls runOrchestration().

import type { SpawnRecord, VMConnection } from "../history.js";
import type { Manifest } from "../manifest.js";
import type { CloudRunner } from "./agent-setup.js";
import type { AgentConfig } from "./agents.js";
import type { SshTunnelHandle } from "./ssh.js";

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { getErrorMessage } from "@grid-spawn/sdk";
import pc from "picocolors";
import * as v from "valibot";
import {
  deleteProvisionCheckpoint,
  generateSpawnId,
  mergeChildHistory,
  patchSpawnRecord,
  saveLaunchCmd,
  saveMetadata,
  SpawnRecordSchema,
  upsertSpawnRecord,
  writeProvisionCheckpoint,
} from "../history.js";
import { offerGithubAuth, setupAutoUpdate, setupSecurityScan, wrapSshCall } from "./agent-setup.js";
import { tryTarballInstall } from "./agent-tarball.js";
import { generateEnvConfig } from "./agents.js";
import { acquireHeadlessProvisionLock } from "./headless-lock.js";
import { fetchGridModelIds } from "./grid-models.js";
import { getOrPromptApiKey } from "./oauth.js";
import { parseJsonWith } from "./parse.js";
import { provisionPhaseIndex } from "./provision-phases.js";
import { getSpawnCloudConfigPath, getSpawnPreferencesPath, getTmpDir } from "./paths.js";
import { asyncTryCatch, asyncTryCatchIf, isOperationalError, tryCatch } from "./result.js";
import { isWindows } from "./shell.js";
import { injectSpawnSkill } from "./spawn-skill.js";
import { sleep, startSshTunnel } from "./ssh.js";
import { buildCloudOrchestratorForResume } from "./resume-cloud-factory.js";
import { ensureSshKeys, getSshKeyOpts } from "./ssh-keys.js";
import { GRID_SPAWN_CLI } from "./cli-invocation.js";
import { captureEvent, setTelemetryContext } from "./telemetry.js";
import { GRID_INFERENCE_DEFAULT_MODEL_ID, VENDOR_AGENT_IMAGE_REGISTRY } from "./vendor-routing.js";
import {
  logAlwaysInfo,
  logAlwaysStep,
  logDebug,
  logError,
  logInfo,
  logStep,
  logWarn,
  openBrowser,
  prepareStdinForHandoff,
  prompt,
  promptGridCatalogModelId,
  retryOrQuit,
  rewriteLocalhostHttpUrlForWindowsBrowserFromWsl,
  shellQuote,
  validateModelId,
  withRetry,
} from "./ui.js";

import { isInteractiveTTY } from "../commands/shared.js";

function logDashboardAuthHandoff(url: string, gatewayToken?: string): void {
  const alt = rewriteLocalhostHttpUrlForWindowsBrowserFromWsl(url);
  const lines = [
    pc.dim("Opening your browser — paste below if the page loses auth:"),
    url,
  ];
  if (alt !== url) {
    lines.push(pc.dim("From Windows Chrome/Edge (WSL):"), alt);
  }
  if (gatewayToken) {
    lines.push(pc.dim("Gateway token — Connect › Gateway Token:"), gatewayToken);
  }
  logAlwaysInfo(lines.join("\n"));
}

// ── Funnel telemetry ────────────────────────────────────────────────────────
//
// Tracks onboarding pipeline drop-off. Events flow through the shared
// PostHog pipeline in shared/telemetry.ts and respect SPAWN_TELEMETRY=0 opt-out.
// No PII — only agent/cloud names and elapsed timing. The goal is to answer
// "where do users bail before reaching a running agent" at the fleet level.
let _funnelStart = 0;

function funnelElapsedMs(): number {
  return _funnelStart > 0 ? Date.now() - _funnelStart : 0;
}

function trackFunnel(step: string, extra: Record<string, unknown> = {}): void {
  captureEvent(step, {
    elapsed_ms: funnelElapsedMs(),
    ...extra,
  });
}

function shortProvisionError(err: unknown): string {
  const m = getErrorMessage(err).replace(/\s+/g, " ").trim();
  return m.length > 400 ? `${m.slice(0, 397)}...` : m;
}

function finalizeProvisionSuccess(spawnId: string, softFailures: string[]): void {
  patchSpawnRecord(spawnId, {
    provision_phase: "complete",
    provision_status: softFailures.length > 0 ? "degraded" : "complete",
    post_install_soft_failures: softFailures.length > 0 ? softFailures : undefined,
    provision_error: undefined,
  });
  deleteProvisionCheckpoint(spawnId);
}

/**
 * Normalize a `--repo` argument into a git clone URL.
 *
 * Accepts:
 *   - GitHub shorthand:  user/repo                  → https://github.com/user/repo.git
 *   - HTTP(S) URL:       https://host/path[.git]    → unchanged
 *   - SSH URL:           ssh://user@host/path       → unchanged
 *   - SCP-style SSH:     git@host:path              → unchanged
 *   - git:// URL:        git://host/path            → unchanged
 *
 * Returns null for anything that contains shell metacharacters, whitespace,
 * leading `-` (would be parsed as a git option), or doesn't look like a URL
 * or `user/repo` slug at all. Defense in depth — the URL is always passed
 * through `shellQuote` at the call site as well.
 */
export function normalizeRepoUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    return null;
  }
  // No shell metacharacters, no whitespace, no NUL bytes
  if (/[\s\0`$;&|<>(){}[\]"'\\!*?#]/.test(trimmed)) {
    return null;
  }
  // Reject leading `-` so the URL can't masquerade as a git flag
  if (trimmed.startsWith("-")) {
    return null;
  }
  // Full URL with scheme
  if (/^(https?|git|ssh|git\+ssh|git\+https?):\/\//i.test(trimmed)) {
    return trimmed;
  }
  // SCP-style: user@host:path (host must contain a dot to disambiguate from GitHub shorthand)
  if (/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+:[a-zA-Z0-9._/~-]+(\.git)?$/.test(trimmed)) {
    return trimmed;
  }
  // GitHub shorthand: user/repo
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  return null;
}

/** Docker container name used by --beta docker deployments. */
export const DOCKER_CONTAINER_NAME = "spawn-agent";
/** Docker registry hosting Grid Spawn agent images (see todo.md until first-party mirrors exist). */
export const DOCKER_REGISTRY = VENDOR_AGENT_IMAGE_REGISTRY;

/** Wrap a command to run inside the Docker container instead of the host. */
function makeDockerExec(cmd: string): string {
  if (!cmd || cmd.length === 0) {
    throw new Error("makeDockerExec: command must be non-empty");
  }
  return `docker exec ${DOCKER_CONTAINER_NAME} bash -c ${shellQuote(cmd)}`;
}

/** Wrap a CloudRunner so all commands and uploads target the Docker container. */
export function makeDockerRunner(hostRunner: CloudRunner): CloudRunner {
  return {
    runServer: (cmd: string, timeoutSecs?: number) => hostRunner.runServer(makeDockerExec(cmd), timeoutSecs),
    uploadFile: async (localPath: string, remotePath: string) => {
      await hostRunner.uploadFile(localPath, remotePath);
      await hostRunner.runServer(
        `docker cp ${shellQuote(remotePath)} ${DOCKER_CONTAINER_NAME}:${shellQuote(remotePath)}`,
      );
    },
    downloadFile: hostRunner.downloadFile,
  };
}

export interface CloudOrchestrator {
  cloudName: string;
  cloudLabel: string;
  capabilities?: CloudOrchestratorCapabilities;
  runner: CloudRunner;
  /** When true, skip tarball + agent install (e.g. booting from a pre-baked snapshot). */
  skipAgentInstall?: boolean;
  /** When true, skip cloud-init wait — just wait for SSH (e.g. minimal-tier agent with tarball). */
  skipCloudInit?: boolean;
  authenticate(): Promise<void>;
  checkAccountReady?(): Promise<void>;
  /** DigitalOcean: blocking readiness (account, SSH, THEGRID_API_KEY) before region/size. */
  ensureReadyBeforeSizing?(): Promise<void>;
  promptSize(): Promise<void>;
  createServer(name: string): Promise<VMConnection>;
  getServerName(): Promise<string>;
  waitForReady(): Promise<void>;
  interactiveSession(cmd: string): Promise<number>;
  /** Return SSH connection info for tunnel support. Omit for non-SSH clouds. */
  getConnectionInfo?(): {
    host: string;
    user: string;
  };
  /** Return a browser URL for signed-preview style dashboard access. */
  getSignedPreviewUrl?(remotePort: number, urlSuffix?: string, expiresInSeconds?: number): Promise<string>;
  /** Install a provider-native auto-update mechanism when the shared systemd timer does not apply. */
  setupAutoUpdate?(agentName: string, updateCmd: string): Promise<void>;
}

export interface CloudOrchestratorCapabilities {
  localRuntime?: boolean;
  skipParallelAccountReadyCheck?: boolean;
  providerManagedAutoUpdate?: boolean;
  disableSecurityScan?: boolean;
  connectionDropExitCodes?: number[];
}

/**
 * Wrap a launch command in a restart loop for cloud VMs.
 * Restarts the agent on non-zero exit (crash, SIGTERM, OOM) up to MAX_RESTARTS times.
 * Clean exits (exit code 0) break out of the loop immediately.
 * Skipped for local execution where the user controls the process directly.
 */
function wrapWithRestartLoop(cmd: string): string {
  // Shell restart loop — bash 3.x compatible (no ((var++)), no set -u)
  return [
    "_spawn_restarts=0",
    "_spawn_max=10",
    'while [ "$_spawn_restarts" -lt "$_spawn_max" ]; do',
    `  ${cmd}`,
    "  _spawn_exit=$?",
    '  if [ "$_spawn_exit" -eq 0 ]; then break; fi',
    "  _spawn_restarts=$((_spawn_restarts + 1))",
    '  printf "\\n[spawn] Agent exited with code %d. Restarting in 5s (%d/%d)...\\n" "$_spawn_exit" "$_spawn_restarts" "$_spawn_max" >&2',
    "  sleep 5",
    "done",
    'if [ "$_spawn_restarts" -ge "$_spawn_max" ]; then',
    '  printf "\\n[spawn] Agent crashed %d times. Giving up.\\n" "$_spawn_max" >&2',
    "fi",
    'exit "${_spawn_exit:-0}"',
  ].join("\n");
}

function isLocalRuntime(cloud: CloudOrchestrator): boolean {
  return cloud.capabilities?.localRuntime ?? cloud.cloudName === "local";
}

function skipParallelAccountReadyCheck(cloud: CloudOrchestrator): boolean {
  return cloud.capabilities?.skipParallelAccountReadyCheck ?? cloud.cloudName === "digitalocean";
}

function providerManagedAutoUpdate(cloud: CloudOrchestrator): boolean {
  return cloud.capabilities?.providerManagedAutoUpdate ?? cloud.cloudName === "daytona";
}

function securityScanDisabled(cloud: CloudOrchestrator): boolean {
  const fromCapabilities = cloud.capabilities?.disableSecurityScan;
  if (fromCapabilities !== undefined) {
    return fromCapabilities;
  }
  return isLocalRuntime(cloud) || cloud.cloudName === "daytona";
}

function isConnectionDropCode(cloud: CloudOrchestrator, code: number): boolean {
  const extraCodes = cloud.capabilities?.connectionDropExitCodes ?? [];
  return code === 255 || extraCodes.includes(code);
}

// ── Recursive spawn helpers ──────────────────────────────────────────────────

/** Install the spawn CLI on a remote VM. */
export async function installSpawnCli(runner: CloudRunner): Promise<void> {
  logStep("Installing spawn CLI on VM...");
  // Build PATH explicitly — non-interactive bash skips .bashrc (PS1 guard),
  // and some platforms (Sprite) have a broken bun shim that finds via
  // `command -v` but doesn't actually work. We prepend all known bun
  // locations so the real binary is found first, then test `bun --version`
  // (not just existence) and install bun fresh if it doesn't work.
  const installCmd = [
    'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"',
    'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/.sprite/languages/bun/bin:/usr/local/bin:$PATH"',
    'if ! bun --version >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"; fi',
    "curl -fsSL https://spawn.thegrid.ai/cli/install.sh | bash",
  ].join("; ");
  const result = await asyncTryCatch(() =>
    withRetry(`${GRID_SPAWN_CLI} CLI install`, () => wrapSshCall(runner.runServer(installCmd)), 2, 5),
  );
  if (!result.ok) {
    logWarn("Spawn CLI install failed — recursive spawning will not be available on this VM");
  } else {
    logAlwaysInfo("Spawn CLI installed on VM");
  }
}

/** Copy local cloud credentials to the remote VM for recursive spawning. */
export async function delegateCloudCredentials(runner: CloudRunner): Promise<void> {
  logStep("Delegating cloud credentials to VM...");

  const filesToDelegate: {
    localPath: string;
    remotePath: string;
  }[] = [];

  // Delegate ALL cloud credentials so the child VM can spawn on any cloud,
  // not just the one the parent is running on.
  const cloudNames = [
    "hetzner",
    "digitalocean",
    "aws",
    "gcp",
    "sprite",
  ];
  for (const cloud of cloudNames) {
    const cloudConfigPath = getSpawnCloudConfigPath(cloud);
    if (existsSync(cloudConfigPath)) {
      filesToDelegate.push({
        localPath: cloudConfigPath,
        remotePath: `~/.config/grid-spawn/${cloud}.json`,
      });
    }
  }

  // Saved The Grid API key (~/.config/grid-spawn/thegrid.json) for child spawns
  const orConfigPath = getSpawnCloudConfigPath("thegrid");
  if (existsSync(orConfigPath)) {
    filesToDelegate.push({
      localPath: orConfigPath,
      remotePath: "~/.config/grid-spawn/thegrid.json",
    });
  }

  if (filesToDelegate.length === 0) {
    logWarn("No credentials to delegate — child spawns may require manual auth");
    return;
  }

  // Ensure config dir exists on VM
  const mkdirResult = await asyncTryCatch(() =>
    runner.runServer("mkdir -p ~/.config/grid-spawn && chmod 700 ~/.config/grid-spawn"),
  );
  if (!mkdirResult.ok) {
    logWarn("Could not create config directory on VM");
    return;
  }

  for (const file of filesToDelegate) {
    const content = readFileSync(file.localPath, "utf-8");
    const b64 = Buffer.from(content).toString("base64");
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
      throw new Error("Unexpected characters in base64 output");
    }
    const writeResult = await asyncTryCatch(() =>
      runner.runServer(`printf '%s' '${b64}' | base64 -d > ${file.remotePath} && chmod 600 ${file.remotePath}`),
    );
    if (!writeResult.ok) {
      logWarn(`Could not delegate ${file.remotePath}`);
    }
  }

  logAlwaysInfo("Cloud credentials delegated to VM");
}

/** Get parent_id and depth fields for spawn records (set when running inside a child VM). */
function getParentFields(): {
  parent_id?: string;
  depth?: number;
} {
  const parentId = process.env.SPAWN_PARENT_ID;
  const depth = Number(process.env.SPAWN_DEPTH) || 0;
  return parentId
    ? {
        parent_id: parentId,
        depth,
      }
    : depth > 0
      ? {
          depth,
        }
      : {};
}

/** Build and persist a SpawnRecord for a newly-created server. */
function recordSpawn(spawnId: string, agentName: string, cloudName: string, connection: VMConnection): void {
  const spawnName = process.env.SPAWN_NAME_KEBAB || process.env.SPAWN_NAME || undefined;
  upsertSpawnRecord({
    id: spawnId,
    agent: agentName,
    cloud: cloudName,
    timestamp: new Date().toISOString(),
    ...(spawnName
      ? {
          name: spawnName,
        }
      : {}),
    ...getParentFields(),
    connection,
    provision_phase: "vm_created",
    provision_status: "in_progress",
    provision_updated_at: new Date().toISOString(),
  });
}

/** Append recursive-spawn env vars to the envPairs array when --beta recursive is active. */
export function appendRecursiveEnvVars(envPairs: string[], spawnId: string): void {
  const currentDepth = Number(process.env.SPAWN_DEPTH) || 0;
  envPairs.push(`SPAWN_PARENT_ID=${spawnId}`);
  envPairs.push(`SPAWN_DEPTH=${currentDepth + 1}`);
  envPairs.push("SPAWN_BETA=recursive");
}

/** Options for runOrchestration (used in tests to inject mock dependencies). */
export interface OrchestrationOptions {
  tryTarball?: (runner: CloudRunner, agentName: string) => Promise<boolean>;
  getApiKey?: (agentSlug?: string, cloudSlug?: string) => Promise<string>;
  /** For tests: supply a cloud when exercising resumeOrchestrationFromRecord without provider APIs. */
  testResumeCloud?: CloudOrchestrator;
  /** For tests: return from resumeOrchestrationFromRecord immediately before runPostInstallPhase (avoids process.exit). */
  testResumeStopBeforePostInstall?: boolean;
}

/**
 * Load a preferred model from ~/.config/grid-spawn/preferences.json.
 * Format: { "models": { "codex": "<Grid catalogue id>", "openclaw": "<Grid catalogue id>" } }
 * Returns null if no preference is set or the file doesn't exist.
 */
const PreferencesSchema = v.object({
  models: v.optional(v.record(v.string(), v.string())),
  starPromptShownAt: v.optional(v.string()),
});

function loadPreferredModel(agentName: string): string | null {
  const result = tryCatch(() => {
    const raw = JSON.parse(readFileSync(getSpawnPreferencesPath(), "utf-8"));
    const parsed = v.safeParse(PreferencesSchema, raw);
    if (!parsed.success) {
      return null;
    }
    return parsed.output.models?.[agentName] ?? null;
  });
  return result.ok ? result.data : null;
}

function agentSupportsGridModelPick(agent: AgentConfig): boolean {
  return agent.modelDefault !== undefined || agent.modelEnvVar !== undefined;
}

function shouldOfferGridModelPicker(agent: AgentConfig, preference: string | null): boolean {
  if (!agentSupportsGridModelPick(agent)) {
    return false;
  }
  if (!isInteractiveTTY()) {
    return false;
  }
  if (
    process.env.SPAWN_NON_INTERACTIVE === "1" ||
    process.env.SPAWN_HEADLESS === "1" ||
    process.env.SPAWN_SKIP_MODEL_PROMPT === "1"
  ) {
    return false;
  }
  if (process.env.MODEL_ID) {
    return false;
  }
  if (preference) {
    return false;
  }
  return true;
}

/** Resolve MODEL_ID → validated id; optionally prompt against `GET …/models` when interactive. */
async function resolveProvisionModelId(agentName: string, agent: AgentConfig, apiKey: string): Promise<string | undefined> {
  const preference = loadPreferredModel(agentName);
  let rawModelId = process.env.MODEL_ID || preference || agent.modelDefault;
  if (
    typeof rawModelId === "string" &&
    rawModelId.trim().length > 0 &&
    /^openrouter\//i.test(rawModelId.trim())
  ) {
    logWarn(
      `Ignoring model id "${rawModelId.trim()}" — OpenRouter-style ids are not The Grid catalogue models. Using ${GRID_INFERENCE_DEFAULT_MODEL_ID} unless the catalogue picker overrides.`,
    );
    rawModelId = preference && !/^openrouter\//i.test(preference.trim()) ? preference : agent.modelDefault;
    if (typeof rawModelId === "string" && /^openrouter\//i.test(rawModelId.trim())) {
      rawModelId = GRID_INFERENCE_DEFAULT_MODEL_ID;
    }
  }

  if (shouldOfferGridModelPicker(agent, preference)) {
    logAlwaysStep("Fetching models from The Grid…");
    const catalogue = await fetchGridModelIds(apiKey);
    if (catalogue.length > 0) {
      const fallback =
        agent.modelDefault && catalogue.includes(agent.modelDefault) ? agent.modelDefault : catalogue[0]!;
      const suggested =
        rawModelId && catalogue.includes(rawModelId) ? rawModelId : fallback;
      const picked = await promptGridCatalogModelId(catalogue, suggested);
      if (picked && validateModelId(picked)) {
        rawModelId = picked;
      }
    } else {
      logWarn("Could not load model catalogue from The Grid — continuing with CLI defaults.");
    }
  }

  const modelId = rawModelId && validateModelId(rawModelId) ? rawModelId : undefined;
  if (rawModelId && !modelId) {
    logWarn(`Ignoring invalid MODEL_ID: ${rawModelId}`);
  }
  return modelId;
}

export async function runOrchestration(
  cloud: CloudOrchestrator,
  agent: AgentConfig,
  agentName: string,
  options?: OrchestrationOptions,
): Promise<void> {
  if (cloud.cloudName === "digitalocean") {
    logStep(`Starting guided ${agent.name} on ${cloud.cloudLabel}`);
  } else {
    logInfo(`${agent.name} on ${cloud.cloudLabel}`);
  }
  process.stderr.write("\n");

  // Funnel telemetry: mark the start of the onboarding pipeline and attach
  // agent/cloud as context so every event carries them automatically.
  _funnelStart = Date.now();
  setTelemetryContext("agent", agentName);
  setTelemetryContext("cloud", cloud.cloudName);
  trackFunnel("funnel_started");

  let failureSpawnId: string | undefined;

  const orchestrationResult = await asyncTryCatch(async () => {
    await cloud.authenticate();
    trackFunnel("funnel_cloud_authed");

    if (cloud.ensureReadyBeforeSizing) {
      await cloud.ensureReadyBeforeSizing();
    }

    const spawnId = generateSpawnId();
    failureSpawnId = spawnId;
    const stubTs = new Date().toISOString();
    writeProvisionCheckpoint({
      id: spawnId,
      agent: agentName,
      cloud: cloud.cloudName,
      timestamp: stubTs,
      provision_phase: "pending",
      provision_status: "in_progress",
      provision_updated_at: stubTs,
      ...getParentFields(),
    });

    const betaFeatures = new Set((process.env.SPAWN_BETA ?? "").split(",").filter(Boolean));
    const fastMode = process.env.SPAWN_FAST === "1" || betaFeatures.has("parallel");
    const useTarball = fastMode || betaFeatures.has("tarball");

    if ((useTarball || cloud.skipAgentInstall) && !isLocalRuntime(cloud) && (agent.cloudInitTier === "minimal" || !agent.cloudInitTier)) {
      cloud.skipCloudInit = true;
    }

    await cloud.promptSize();
    patchSpawnRecord(spawnId, {
      provision_phase: "cloud_authenticated",
      provision_status: "in_progress",
    });

    acquireHeadlessProvisionLock();

    const serverName = await cloud.getServerName();

    if (fastMode && !isLocalRuntime(cloud)) {
      const keepAlive = setInterval(() => {}, 60_000);

      const serverBootPromise = (async () => {
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_creating",
          provision_status: "in_progress",
        });
        const conn = await cloud.createServer(serverName);
        recordSpawn(spawnId, agentName, cloud.cloudName, conn);
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_waiting",
          provision_status: "in_progress",
        });
        await cloud.waitForReady();
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_ready",
          provision_status: "in_progress",
        });
        return conn;
      })();

      const resolveApiKey = options?.getApiKey ?? getOrPromptApiKey;

      const [bootResult, apiKeyResult] = await Promise.allSettled([
        serverBootPromise,
        resolveApiKey(agentName, cloud.cloudName),
        skipParallelAccountReadyCheck(cloud)
          ? Promise.resolve({
              ok: true as const,
            })
          : cloud.checkAccountReady
            ? asyncTryCatch(() => cloud.checkAccountReady!())
            : Promise.resolve({
                ok: true,
              }),
        agent.preProvision
          ? asyncTryCatch(() => agent.preProvision!())
          : Promise.resolve({
              ok: true,
            }),
      ]);

      if (bootResult.status === "rejected") {
        logError(getErrorMessage(bootResult.reason));
        await retryOrQuit("Retry server creation?");
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_creating",
          provision_status: "in_progress",
        });
        const connection = await cloud.createServer(serverName);
        recordSpawn(spawnId, agentName, cloud.cloudName, connection);
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_waiting",
          provision_status: "in_progress",
        });
        await cloud.waitForReady();
        patchSpawnRecord(spawnId, {
          provision_phase: "vm_ready",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_vm_ready");

      if (apiKeyResult.status === "rejected") {
        throw apiKeyResult.reason;
      }
      const apiKey = apiKeyResult.value;
      patchSpawnRecord(spawnId, {
        provision_phase: "credentials_ready",
        provision_status: "in_progress",
      });
      trackFunnel("funnel_credentials_ready");

      const modelId = await resolveProvisionModelId(agentName, agent, apiKey);

      const envPairs = agent.envVars(apiKey);
      if (modelId && agent.modelEnvVar) {
        envPairs.push(`${agent.modelEnvVar}=${modelId}`);
      }
      if (betaFeatures.has("recursive")) {
        appendRecursiveEnvVars(envPairs, spawnId);
      }
      const envContent = generateEnvConfig(envPairs);

      if (cloud.skipAgentInstall) {
        logInfo("Snapshot boot — skipping agent install");
      } else {
        patchSpawnRecord(spawnId, {
          provision_phase: "agent_installing",
          provision_status: "in_progress",
        });
        let installed = false;
        if (useTarball && !agent.skipTarball) {
          const tarball = options?.tryTarball ?? tryTarballInstall;
          installed = await tarball(cloud.runner, agentName);
        }
        if (!installed) {
          for (;;) {
            const r = await asyncTryCatch(() => agent.install());
            if (r.ok) {
              break;
            }
            logError(getErrorMessage(r.error));
            await retryOrQuit("Retry agent install?");
          }
        }
        patchSpawnRecord(spawnId, {
          provision_phase: "agent_installed",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_install_completed");

      clearInterval(keepAlive);
      const envSoft: string[] = [];
      patchSpawnRecord(spawnId, {
        provision_phase: "env_injecting",
        provision_status: "in_progress",
      });
      await injectEnvVars(cloud, envContent, envSoft);
      patchSpawnRecord(spawnId, {
        provision_phase: "env_injected",
        provision_status: "in_progress",
      });
      patchSpawnRecord(spawnId, {
        provision_phase: "post_install",
        provision_status: "in_progress",
      });
      await runPostInstallPhase(cloud, agent, agentName, apiKey, modelId, spawnId, envSoft, options);
    } else {
      if (cloud.checkAccountReady && !skipParallelAccountReadyCheck(cloud)) {
        const r = await asyncTryCatch(() => cloud.checkAccountReady!());
        if (!r.ok) {
          logWarn("Account readiness check failed — proceeding anyway");
          logDebug(getErrorMessage(r.error));
        }
      }

      const resolveApiKey = options?.getApiKey ?? getOrPromptApiKey;
      const apiKey = await resolveApiKey(agentName, cloud.cloudName);
      patchSpawnRecord(spawnId, {
        provision_phase: "credentials_ready",
        provision_status: "in_progress",
      });
      trackFunnel("funnel_credentials_ready");

      if (agent.preProvision) {
        const r = await asyncTryCatch(() => agent.preProvision!());
        if (!r.ok) {
          logWarn("Pre-provision hook failed — continuing");
          logDebug(getErrorMessage(r.error));
        }
      }

      const modelId = await resolveProvisionModelId(agentName, agent, apiKey);

      let connection: VMConnection;
      patchSpawnRecord(spawnId, {
        provision_phase: "vm_creating",
        provision_status: "in_progress",
      });
      for (;;) {
        const r = await asyncTryCatch(() => cloud.createServer(serverName));
        if (r.ok) {
          connection = r.data;
          break;
        }
        logError(getErrorMessage(r.error));
        await retryOrQuit("Retry server creation?");
      }
      recordSpawn(spawnId, agentName, cloud.cloudName, connection);

      patchSpawnRecord(spawnId, {
        provision_phase: "vm_waiting",
        provision_status: "in_progress",
      });
      for (;;) {
        const r = await asyncTryCatch(() => cloud.waitForReady());
        if (r.ok) {
          break;
        }
        logError(getErrorMessage(r.error));
        await retryOrQuit("Server may still be starting. Keep waiting?");
      }
      patchSpawnRecord(spawnId, {
        provision_phase: "vm_ready",
        provision_status: "in_progress",
      });
      trackFunnel("funnel_vm_ready");

      const envPairs = agent.envVars(apiKey);
      if (modelId && agent.modelEnvVar) {
        envPairs.push(`${agent.modelEnvVar}=${modelId}`);
      }
      if (betaFeatures.has("recursive")) {
        appendRecursiveEnvVars(envPairs, spawnId);
      }
      const envContent = generateEnvConfig(envPairs);

      if (cloud.skipAgentInstall) {
        logInfo("Snapshot boot — skipping agent install");
      } else {
        patchSpawnRecord(spawnId, {
          provision_phase: "agent_installing",
          provision_status: "in_progress",
        });
        let installedFromTarball = false;
        if (!isLocalRuntime(cloud) && !agent.skipTarball && useTarball) {
          const tarball = options?.tryTarball ?? tryTarballInstall;
          installedFromTarball = await tarball(cloud.runner, agentName);
        }
        if (!installedFromTarball) {
          for (;;) {
            const r = await asyncTryCatch(() => agent.install());
            if (r.ok) {
              break;
            }
            logError(getErrorMessage(r.error));
            await retryOrQuit("Retry agent install?");
          }
        }
        patchSpawnRecord(spawnId, {
          provision_phase: "agent_installed",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_install_completed");

      const envSoft: string[] = [];
      patchSpawnRecord(spawnId, {
        provision_phase: "env_injecting",
        provision_status: "in_progress",
      });
      await injectEnvVars(cloud, envContent, envSoft);
      patchSpawnRecord(spawnId, {
        provision_phase: "env_injected",
        provision_status: "in_progress",
      });
      patchSpawnRecord(spawnId, {
        provision_phase: "post_install",
        provision_status: "in_progress",
      });
      await runPostInstallPhase(cloud, agent, agentName, apiKey, modelId, spawnId, envSoft, options);
    }
  });

  if (!orchestrationResult.ok) {
    if (failureSpawnId) {
      patchSpawnRecord(failureSpawnId, {
        provision_status: "failed",
        provision_error: shortProvisionError(orchestrationResult.error),
      });
    }
    throw orchestrationResult.error;
  }
}

/** Continue provisioning from last recorded phase (DigitalOcean / Hetzner SSH clouds). */
export async function resumeOrchestrationFromRecord(
  record: SpawnRecord,
  manifest: Manifest,
  options?: OrchestrationOptions,
): Promise<void> {
  if (!manifest.agents[record.agent]) {
    throw new Error(`Unknown agent in history: ${record.agent}`);
  }

  patchSpawnRecord(record.id, {
    provision_status: "in_progress",
    provision_error: undefined,
  });

  const cloud = options?.testResumeCloud ?? (await buildCloudOrchestratorForResume(record));
  if (!cloud) {
    throw new Error(
      `Resume needs a saved SSH connection. Unsupported or missing cloud connection — try ${GRID_SPAWN_CLI} fix.`,
    );
  }

  setTelemetryContext("agent", record.agent);
  setTelemetryContext("cloud", record.cloud);

  await cloud.authenticate();

  const { createCloudAgentsFromModules } = await import("./agent-module-registry.js");
  const { resolveAgent } = createCloudAgentsFromModules(cloud.runner);
  const agent = resolveAgent(record.agent);

  const resolveApiKey = options?.getApiKey ?? getOrPromptApiKey;
  const apiKey = await resolveApiKey(record.agent, record.cloud);

  const modelId = await resolveProvisionModelId(record.agent, agent, apiKey);
  const betaFeatures = new Set((process.env.SPAWN_BETA ?? "").split(",").filter(Boolean));
  const useTarball =
    process.env.SPAWN_FAST === "1" || betaFeatures.has("parallel") || betaFeatures.has("tarball");

  const envPairs = agent.envVars(apiKey);
  if (modelId && agent.modelEnvVar) {
    envPairs.push(`${agent.modelEnvVar}=${modelId}`);
  }
  if (betaFeatures.has("recursive")) {
    appendRecursiveEnvVars(envPairs, record.id);
  }
  const envContent = generateEnvConfig(envPairs);

  const phaseIdx = provisionPhaseIndex(record.provision_phase);

  if (phaseIdx < provisionPhaseIndex("vm_ready")) {
    patchSpawnRecord(record.id, {
      provision_phase: "vm_waiting",
    });
    await cloud.waitForReady();
    patchSpawnRecord(record.id, {
      provision_phase: "vm_ready",
    });
  }

  if (phaseIdx < provisionPhaseIndex("agent_installed")) {
    if (cloud.skipAgentInstall) {
      logInfo("Snapshot boot — skipping agent install");
    } else {
      patchSpawnRecord(record.id, {
        provision_phase: "agent_installing",
      });
      let installed = false;
      if (useTarball && !agent.skipTarball) {
        const tarball = options?.tryTarball ?? tryTarballInstall;
        installed = await tarball(cloud.runner, record.agent);
      }
      if (!installed) {
        const r = await asyncTryCatch(() => agent.install());
        if (!r.ok) {
          throw r.error;
        }
      }
    }
    patchSpawnRecord(record.id, {
      provision_phase: "agent_installed",
    });
  }

  const envSoft: string[] = [];
  if (phaseIdx < provisionPhaseIndex("env_injected")) {
    patchSpawnRecord(record.id, {
      provision_phase: "env_injecting",
    });
    await injectEnvVars(cloud, envContent, envSoft);
    patchSpawnRecord(record.id, {
      provision_phase: "env_injected",
    });
  }

  patchSpawnRecord(record.id, {
    provision_phase: "post_install",
  });
  if (options?.testResumeStopBeforePostInstall) {
    return;
  }
  await runPostInstallPhase(cloud, agent, record.agent, apiKey, modelId, record.id, envSoft, options);
}

/** Write env content to ~/.spawnrc and ensure all shell rc files source it. */
export async function injectEnvVarsToRunner(runner: CloudRunner, envContent: string): Promise<boolean> {
  logStep("Setting up environment variables...");
  const envB64 = Buffer.from(envContent).toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(envB64)) {
    throw new Error("Unexpected characters in base64 output");
  }

  const envSetupCmd =
    `printf '%s' '${envB64}' | base64 -d > ~/.spawnrc && chmod 600 ~/.spawnrc; ` +
    "for _rc in ~/.bashrc ~/.profile ~/.bash_profile ~/.zshrc; do " +
    `grep -q 'source ~/.spawnrc' "$_rc" 2>/dev/null || echo '[ -f ~/.spawnrc ] && source ~/.spawnrc' >> "$_rc"; ` +
    "done";

  const envResult = await asyncTryCatch(() =>
    withRetry("env setup", () => wrapSshCall(runner.runServer(envSetupCmd)), 2, 5),
  );
  if (!envResult.ok) {
    logWarn("Environment setup had errors");
    return false;
  }
  return true;
}

async function injectEnvVars(cloud: CloudOrchestrator, envContent: string, softFailures: string[]): Promise<void> {
  const isLocalWindows = isLocalRuntime(cloud) && isWindows();
  if (isLocalWindows) {
    logStep("Setting up environment variables...");
    const envB64 = Buffer.from(envContent).toString("base64");
    if (!/^[A-Za-z0-9+/=]+$/.test(envB64)) {
      throw new Error("Unexpected characters in base64 output");
    }
    const envSetupCmd =
      `$bytes = [Convert]::FromBase64String('${envB64}'); ` + `[IO.File]::WriteAllBytes("$HOME/.spawnrc", $bytes)`;
    const envResult = await asyncTryCatch(() =>
      withRetry("env setup", () => wrapSshCall(cloud.runner.runServer(envSetupCmd)), 2, 5),
    );
    if (!envResult.ok) {
      logWarn("Environment setup had errors");
      softFailures.push("env_inject");
    }
    return;
  }
  const ok = await injectEnvVarsToRunner(cloud.runner, envContent);
  if (!ok) {
    softFailures.push("env_inject");
  }
}

export async function runPostInstallPhase(
  cloud: CloudOrchestrator,
  agent: AgentConfig,
  agentName: string,
  apiKey: string,
  modelId: string | undefined,
  spawnId: string,
  provisionSoftFailures: string[],
  options?: OrchestrationOptions,
): Promise<void> {
  const soft = provisionSoftFailures;
  // ── Repo clone + spawn.md (--repo mode) ────────────────────────────────
  // Built-in steps (github, auto-update, etc.) come from the CLI --steps
  // flag, not from spawn.md.  spawn.md only handles custom setup (OAuth,
  // MCP servers, setup commands).
  let spawnMdConfig: import("./spawn-md.js").SpawnMdConfig | null = null;
  let repoCloned = false;
  const repoArg = process.env.SPAWN_REPO;
  if (repoArg && !isLocalRuntime(cloud)) {
    const cloneUrl = normalizeRepoUrl(repoArg);
    if (!cloneUrl) {
      logWarn(`Invalid --repo value: ${repoArg} — skipping repo clone`);
    } else {
      logStep("Cloning template repository...");
      const cloneResult = await asyncTryCatch(() =>
        cloud.runner.runServer(`git clone ${shellQuote(cloneUrl)} ~/project`),
      );
      if (!cloneResult.ok) {
        logWarn(`Repo clone failed (${getErrorMessage(cloneResult.error)}) — continuing without template`);
        soft.push("repo_clone");
      } else {
        repoCloned = true;
        const { readRemoteSpawnMd } = await import("./spawn-md.js");
        spawnMdConfig = await readRemoteSpawnMd(cloud.runner);
        if (spawnMdConfig) {
          logInfo(`Template loaded: ${spawnMdConfig.name ?? repoArg}`);
        }
      }
    }
  }

  // Parse enabled setup steps
  let enabledSteps: Set<string> | undefined;
  const stepsEnv = process.env.SPAWN_ENABLED_STEPS;
  const isHeadless = process.env.SPAWN_HEADLESS === "1";
  if (stepsEnv !== undefined) {
    const stepNames = stepsEnv.split(",").filter(Boolean);
    if (stepNames.length > 0) {
      const { validateStepNames } = await import("./agents.js");
      const { valid, invalid } = validateStepNames(agentName, stepNames);
      if (invalid.length > 0) {
        logWarn(`Unknown setup steps ignored: ${invalid.join(", ")}`);
      }
      enabledSteps = new Set(valid);
    } else {
      enabledSteps = new Set();
    }
  } else if (isHeadless) {
    // In headless mode, default to auto-update only (use --steps all to override)
    enabledSteps = new Set([
      "auto-update",
    ]);
  }

  // Agent-specific configuration
  if (agent.configure) {
    logAlwaysStep(`${agent.name}: remote configuration…`);
    const configResult = await asyncTryCatch(() =>
      withRetry("agent config", () => wrapSshCall(agent.configure!(apiKey, modelId, enabledSteps)), 2, 5),
    );
    if (!configResult.ok) {
      logWarn("Agent configuration failed (continuing with defaults)");
      soft.push("agent_configure");
    }
  }
  trackFunnel("funnel_configure_completed");

  // GitHub CLI setup
  if (!enabledSteps || enabledSteps.has("github")) {
    await offerGithubAuth(cloud.runner, enabledSteps?.has("github"));
  }

  // Auto-update service
  if (!isLocalRuntime(cloud) && agent.updateCmd && (!enabledSteps || enabledSteps.has("auto-update"))) {
    if (providerManagedAutoUpdate(cloud)) {
      // Daytona reconnects need to know whether they should recreate the provider-native
      // background updater after a sandbox stop/start cycle.
      saveMetadata(
        {
          auto_update_enabled: "1",
        },
        spawnId,
      );
    }
    if (cloud.setupAutoUpdate) {
      await cloud.setupAutoUpdate(agentName, agent.updateCmd);
    } else {
      await setupAutoUpdate(cloud.runner, agentName, agent.updateCmd);
    }
  } else if (providerManagedAutoUpdate(cloud) && agent.updateCmd) {
    // Persist the disabled state too so reconnect paths can distinguish "not configured"
    // from "configured earlier but the sandbox session was lost".
    saveMetadata(
      {
        auto_update_enabled: "0",
      },
      spawnId,
    );
  }

  // Security scan cron
  if (!securityScanDisabled(cloud) && (!enabledSteps || enabledSteps.has("security-scan"))) {
    await setupSecurityScan(cloud.runner);
  }

  // Spawn CLI + skill injection (recursive spawn)
  // The "spawn" step is defaultOn when --beta recursive is active, so it should
  // run when no explicit steps are selected (!enabledSteps) AND the beta flag is set.
  const betaFeaturesPost = new Set((process.env.SPAWN_BETA ?? "").split(",").filter(Boolean));
  if (
    !isLocalRuntime(cloud) &&
    betaFeaturesPost.has("recursive") &&
    (!enabledSteps || enabledSteps.has("spawn"))
  ) {
    await installSpawnCli(cloud.runner);
    await delegateCloudCredentials(cloud.runner);
    await injectSpawnSkill(cloud.runner, agentName);
  }

  // Skill installation (--beta skills)
  const selectedSkillsEnv = process.env.SPAWN_SELECTED_SKILLS;
  if (selectedSkillsEnv && !isLocalRuntime(cloud)) {
    const skillIds = selectedSkillsEnv.split(",").filter(Boolean);
    if (skillIds.length > 0) {
      const { loadManifest } = await import("../manifest.js");
      const manifestForSkills = await loadManifest();
      if (manifestForSkills.skills) {
        const { installSkills } = await import("./skills.js");
        await installSkills(cloud.runner, manifestForSkills, agentName, skillIds);

        // Append skill env vars to .spawnrc so MCP servers can resolve ${VAR} at runtime
        const skillEnvPairs = (process.env.SPAWN_SKILL_ENV_PAIRS ?? "").split(",").filter(Boolean);
        if (skillEnvPairs.length > 0) {
          const validKeyRe = /^[A-Z_][A-Z0-9_]*$/;
          const envLines = skillEnvPairs
            .map((pair) => {
              const eqIdx = pair.indexOf("=");
              if (eqIdx === -1) {
                return "";
              }
              const key = pair.slice(0, eqIdx);
              if (!validKeyRe.test(key)) {
                logWarn(`Skipping invalid skill env var key: ${key}`);
                return "";
              }
              const val = pair.slice(eqIdx + 1);
              const valB64 = Buffer.from(val).toString("base64");
              if (!/^[A-Za-z0-9+/=]+$/.test(valB64)) {
                logWarn(`Skipping skill env var with invalid base64: ${key}`);
                return "";
              }
              return `export ${key}="$(echo '${valB64}' | base64 -d)"`;
            })
            .filter(Boolean)
            .join("\n");
          if (envLines) {
            const payload = `\n# [spawn:skills]\n${envLines}\n`;
            const payloadB64 = Buffer.from(payload).toString("base64");
            if (!/^[A-Za-z0-9+/=]+$/.test(payloadB64)) {
              logWarn("Unexpected characters in skill env payload base64");
            } else {
              await asyncTryCatch(() =>
                cloud.runner.runServer(`printf '%s' '${payloadB64}' | base64 -d >> ~/.spawnrc`),
              );
            }
          }
        }
      }
    }
  }

  // Apply spawn.md custom setup (after built-in steps, before pre-launch)
  if (spawnMdConfig) {
    const { applySpawnMdSetup } = await import("./spawn-md.js");
    await applySpawnMdSetup(cloud.runner, spawnMdConfig, agentName);
  }

  // Pre-launch hooks (retry loop)
  if (agent.preLaunch) {
    for (;;) {
      const r = await asyncTryCatch(() => agent.preLaunch!());
      if (r.ok) {
        break;
      }
      logError(getErrorMessage(r.error));
      await retryOrQuit("Retry pre-launch setup?");
    }
  }
  trackFunnel("funnel_prelaunch_completed");

  // Web dashboard access
  let tunnelHandle: SshTunnelHandle | undefined;
  if (agent.tunnel) {
    const tunnelCfg = agent.tunnel; // capture for closure (TS can't narrow across async boundaries)
    const templateUrl = tunnelCfg.browserUrl?.(0);

    if (cloud.getConnectionInfo) {
      const getConnInfo = cloud.getConnectionInfo; // capture for closure
      const tunnelResult = await asyncTryCatchIf(isOperationalError, async () => {
        const conn = getConnInfo();
        const keys = await ensureSshKeys();
        tunnelHandle = await startSshTunnel({
          host: conn.host,
          user: conn.user,
          remotePort: tunnelCfg.remotePort,
          sshKeyOpts: getSshKeyOpts(keys),
        });
        if (tunnelCfg.browserUrl) {
          const url = tunnelCfg.browserUrl(tunnelHandle.localPort);
          if (url) {
          logAlwaysStep("Web dashboard — Control UI");
          logDashboardAuthHandoff(url, tunnelCfg.logGatewayToken);
          openBrowser(url);
          }
        }
      });
      if (!tunnelResult.ok) {
        logWarn("Web dashboard tunnel failed — use the TUI instead");
        soft.push("dashboard_tunnel");
      }
    } else if (cloud.getSignedPreviewUrl) {
      const previewResult = await asyncTryCatchIf(isOperationalError, async () => {
        const urlSuffix = templateUrl
          ? templateUrl.replace(/^http:\/\/127\.0\.0\.1:0/, "").replace(/^http:\/\/localhost:0/, "")
          : undefined;
        const url = await cloud.getSignedPreviewUrl!(tunnelCfg.remotePort, urlSuffix, 3600);
        openBrowser(url);
      });
      if (!previewResult.ok) {
        logWarn("Web dashboard preview failed — use the TUI instead");
        soft.push("dashboard_preview");
      }
    } else if (isLocalRuntime(cloud)) {
      if (agent.tunnel.browserUrl) {
        const url = agent.tunnel.browserUrl(agent.tunnel.remotePort);
        if (url) {
          logAlwaysStep("Web dashboard — Control UI");
          logDashboardAuthHandoff(url, tunnelCfg.logGatewayToken);
          openBrowser(url);
        }
      }
    }

    const tunnelMeta: Record<string, string> = {
      tunnel_remote_port: String(agent.tunnel.remotePort),
    };
    if (templateUrl) {
      tunnelMeta.tunnel_browser_url_template = templateUrl
        .replace("127.0.0.1:0", "127.0.0.1:__PORT__")
        .replace("localhost:0", "localhost:__PORT__");
    }
    saveMetadata(tunnelMeta, spawnId);
  }

  // Channel setup
  const ocPath = "export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH";

  if (enabledSteps?.has("telegram")) {
    logAlwaysStep("Telegram pairing");
    logAlwaysInfo(
      [
        pc.dim("Steps:"),
        "  1. Open Telegram on your phone",
        "  2. Find the bot you created with @BotFather",
        '  3. Send any message (e.g. "hello")',
        "  4. Enter the pairing code the bot sends",
      ].join("\n"),
    );
    process.stderr.write("\n");
    const pairingCode = (await prompt("Telegram pairing code: ")).trim();
    if (pairingCode) {
      const escaped = shellQuote(pairingCode);
      const result = await asyncTryCatchIf(isOperationalError, () =>
        cloud.runner.runServer(
          `source ~/.spawnrc 2>/dev/null; ${ocPath}; openclaw pairing approve telegram ${escaped}`,
        ),
      );
      if (result.ok) {
        logAlwaysInfo("Telegram paired successfully");
      } else {
        logWarn("Pairing failed — you can pair later via: openclaw pairing approve telegram <CODE>");
      }
    } else {
      logAlwaysInfo("No code entered — pair later via: openclaw pairing approve telegram <CODE>");
    }
  }

  if (agent.preLaunchMsg) {
    process.stderr.write("\n");
    logAlwaysInfo(`Tip: ${agent.preLaunchMsg}`);
  }

  // Launch agent
  logAlwaysInfo(`Agent setup complete — ${agent.name} is ready on ${cloud.cloudLabel}`);
  process.stderr.write("\n");

  // Final funnel event — pipeline completed all the way to handoff.
  // Downstream analysis: (funnel_started count) - (funnel_handoff count) =
  // total drop-off. Per-step counts reveal where the drop-off happens.
  trackFunnel("funnel_handoff", {
    headless: process.env.SPAWN_HEADLESS === "1",
  });

  // When --repo cloned successfully, launch the agent inside the cloned
  // project directory. Gate on the actual clone outcome rather than the flag
  // so an invalid slug or clone failure doesn't leave the agent trying to cd
  // into a non-existent dir.
  const baseLaunchCmd = agent.launchCmd();
  const launchCmd = repoCloned ? `cd ~/project && ${baseLaunchCmd}` : baseLaunchCmd;
  saveLaunchCmd(launchCmd, spawnId);
  finalizeProvisionSuccess(spawnId, soft);

  // In headless mode, provisioning is done — skip the interactive session.
  // If --prompt was provided and the agent has a promptCmd, execute the prompt on the VM.
  if (isHeadless) {
    const headlessPrompt = process.env.SPAWN_PROMPT;
    if (headlessPrompt && agent.promptCmd) {
      logAlwaysInfo("Headless mode — running prompt on provisioned VM...");
      const promptRunCmd = agent.promptCmd(headlessPrompt);
      const promptResult = await asyncTryCatch(() => cloud.runner.runServer(promptRunCmd, 600));
      if (!promptResult.ok) {
        logWarn(`Prompt execution failed: ${getErrorMessage(promptResult.error)}`);
      } else {
        logAlwaysInfo("Prompt execution completed");
      }
    } else {
      logAlwaysInfo("Headless mode — provisioning complete. Skipping interactive session.");
    }
    if (tunnelHandle) {
      logAlwaysInfo(
        "Closing SSH tunnel to the dashboard — localhost URLs only work while grid-spawn holds the tunnel open.",
      );
      logAlwaysInfo(
        `The gateway on your VM keeps running. Re-open the UI: run ${GRID_SPAWN_CLI} list → pick this server → "Open Dashboard".`,
      );
      tunnelHandle.stop();
    }
    if (!isLocalRuntime(cloud)) {
      await pullChildHistory(cloud.runner, spawnId);
    }
    process.exit(0);
  }

  logAlwaysStep("Provisioning complete. Connecting to agent session...");

  // Reset terminal state before handing off to the interactive SSH session.
  // @clack/prompts may have left the cursor hidden or set ANSI attributes
  // (e.g. color, bold) that would corrupt the remote agent's TUI rendering.
  if (process.stderr.isTTY) {
    process.stderr.write("\x1b[?25h\x1b[0m");
  }

  prepareStdinForHandoff();

  const sessionCmd = isLocalRuntime(cloud) ? launchCmd : wrapWithRestartLoop(launchCmd);

  // Auto-reconnect on connection drops. Ctrl+C (exit 0 or 130) exits immediately.
  // Only applies to remote clouds — local sessions don't have connection drops.
  // SSH exits 255 on connection loss; Sprite CLI exits 1 on "connection closed".
  const maxReconnects = isLocalRuntime(cloud) ? 0 : 5;
  const isConnectionDrop = (code: number): boolean => isConnectionDropCode(cloud, code);
  let exitCode = 0;

  for (let attempt = 0; attempt <= maxReconnects; attempt++) {
    if (attempt > 0) {
      process.stderr.write("\n");
      logWarn(`Connection lost. Reconnecting... (${attempt}/${maxReconnects})`);
      await sleep(3000);
      prepareStdinForHandoff();
    }
    exitCode = await cloud.interactiveSession(sessionCmd);

    if (!isConnectionDrop(exitCode)) {
      break;
    }
  }

  if (isConnectionDrop(exitCode)) {
    process.stderr.write("\n");
    logWarn("Could not reconnect. Server is still running.");
    logAlwaysInfo(`Reconnect manually: ${GRID_SPAWN_CLI} last`);
  }

  if (tunnelHandle) {
    tunnelHandle.stop();
  }

  // Pull child's spawn history back to the parent for `spawn tree`.
  // Fire-and-forget — never delay exit for a convenience feature.
  // process.exit() below kills any in-flight SSH calls.
  if (!isLocalRuntime(cloud)) {
    pullChildHistory(cloud.runner, spawnId).catch(() => {});
  }

  process.exit(exitCode);
}

/**
 * Pull spawn history from a child VM and merge it into local history.
 * First tells the child to recursively pull from ITS children via
 * `grid-spawn pull-history`, then downloads the child's history.json.
 * This enables `spawn tree` to show the full recursive hierarchy.
 */
async function pullChildHistory(runner: CloudRunner, parentSpawnId: string): Promise<void> {
  const result = await asyncTryCatch(async () => {
    const tmpPath = `${getTmpDir()}/child-history-${parentSpawnId}.json`;

    // Recursive pull: tell the child to pull from ALL its children first.
    const recursePull = await asyncTryCatch(() =>
      runner.runServer(
        'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"; grid-spawn pull-history 2>/dev/null || true',
        120,
      ),
    );
    if (!recursePull.ok) {
      logDebug("Recursive history pull skipped");
    }

    // Copy the child's history to a temp location then download
    const copyResult = await asyncTryCatch(() =>
      runner.runServer(
        "cp ~/.config/grid-spawn/history.json /tmp/_spawn_history.json 2>/dev/null || cp ~/.config/grid-spawn/history.json /tmp/_spawn_history.json 2>/dev/null || echo '{}'  > /tmp/_spawn_history.json",
      ),
    );
    if (!copyResult.ok) {
      return;
    }

    await runner.downloadFile("/tmp/_spawn_history.json", tmpPath);

    const json = readFileSync(tmpPath, "utf-8");
    const ChildHistorySchema = v.object({
      version: v.optional(v.number()),
      records: v.array(SpawnRecordSchema),
    });
    const parsed = parseJsonWith(json, ChildHistorySchema);
    if (!parsed || parsed.records.length === 0) {
      return;
    }

    const validRecords: SpawnRecord[] = [];
    for (const r of parsed.records) {
      if (r.id) {
        validRecords.push({
          id: r.id,
          agent: r.agent,
          cloud: r.cloud,
          timestamp: r.timestamp,
          ...(r.name
            ? {
                name: r.name,
              }
            : {}),
          ...(r.parent_id
            ? {
                parent_id: r.parent_id,
              }
            : {}),
          ...(r.depth !== undefined
            ? {
                depth: r.depth,
              }
            : {}),
          ...(r.connection
            ? {
                connection: r.connection,
              }
            : {}),
        });
      }
    }

    if (validRecords.length > 0) {
      mergeChildHistory(parentSpawnId, validRecords);
      logInfo(`Pulled ${validRecords.length} spawn record(s) from child VM`);
    }

    tryCatch(() => unlinkSync(tmpPath));
  });

  if (!result.ok) {
    logDebug(`Could not pull child history: ${getErrorMessage(result.error)}`);
  }
}
