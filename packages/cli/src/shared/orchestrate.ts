// shared/orchestrate.ts — Shared orchestration pipeline for deploying agents
// Each cloud implements CloudOrchestrator and calls runOrchestration().

import type { AgentseaRecord, VMConnection } from "../history.js";
import type { Manifest } from "../manifest.js";
import type { CloudRunner } from "./agent-setup.js";
import type { AgentConfig } from "./agents.js";
import type { SshTunnelHandle } from "./ssh.js";

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { getErrorMessage } from "@agentsea/sdk";
import pc from "picocolors";
import * as v from "valibot";
import {
  deleteProvisionCheckpoint,
  findReusableLocalRecordId,
  generateAgentseaId,
  mergeChildHistory,
  patchAgentseaRecord,
  saveLaunchCmd,
  saveMetadata,
  AgentseaRecordSchema,
  upsertAgentseaRecord,
  writeProvisionCheckpoint,
} from "../history.js";
import { offerGithubAuth, setupAutoUpdate, setupSecurityScan, wrapSshCall } from "./agent-setup.js";
import { ensureHermesDashboard } from "./hermes-dashboard.js";
import { tryTarballInstall } from "./agent-tarball.js";
import { getCdnOrigin } from "./cdn.js";
import { generateEnvConfig } from "./agents.js";
import { acquireHeadlessProvisionLock } from "./headless-lock.js";
import { TOOL_E2E_FILE, assertToolE2eFileCmd, wrapHeadlessPromptCmd } from "./headless-prompts.js";
import { fetchGridModelCatalog } from "./grid-models.js";
import { ensureGridModelHasCredits } from "./grid-credits-guidance.js";
import { getOrPromptApiKey } from "./oauth.js";
import { parseJsonWith } from "./parse.js";
import { provisionPhaseIndex } from "./provision-phases.js";
import { getAgentseaCloudConfigPath, getAgentseaPreferencesPath, getTmpDir } from "./paths.js";
import { asyncTryCatch, asyncTryCatchIf, isOperationalError, tryCatch } from "./result.js";
import { isWindows } from "./shell.js";
import { injectAgentseaSkill } from "./agentsea-skill.js";
import { sleep, startSshTunnel } from "./ssh.js";
import { logT3PairingHandoff, startT3PairingBrowserWatcher } from "./t3-config.js";
import { buildCloudOrchestratorForResume } from "./resume-cloud-factory.js";
import { ensureSshKeys, getSshKeyOpts } from "./ssh-keys.js";
import { AGENTSEA_CLI } from "./cli-invocation.js";
import { captureEvent, setTelemetryContext } from "./telemetry.js";
import {
  AGENTSEA_HEARTBEAT_MODEL_ENV,
  GRID_INFERENCE_DEFAULT_MODEL_ID,
  VENDOR_AGENT_IMAGE_REGISTRY,
} from "./vendor-routing.js";
import { agentSupportsHeartbeatModel } from "./grid-instruments.js";
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
  promptHarnessGridModels,
  retryOrQuit,
  rewriteLocalhostHttpUrlForWindowsBrowserFromWsl,
  runWithSpinner,
  shellQuote,
  validateModelId,
  withRetry,
} from "./ui.js";

import { isInteractiveTTY } from "../commands/shared.js";
import { isAgentseaVerbose } from "./verbosity.js";

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
// PostHog pipeline in shared/telemetry.ts and respect AGENTSEA_TELEMETRY=0 opt-out.
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

function finalizeProvisionSuccess(agentseaId: string, softFailures: string[]): void {
  patchAgentseaRecord(agentseaId, {
    provision_phase: "complete",
    provision_status: softFailures.length > 0 ? "degraded" : "complete",
    post_install_soft_failures: softFailures.length > 0 ? softFailures : undefined,
    provision_error: undefined,
  });
  deleteProvisionCheckpoint(agentseaId);
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
export const DOCKER_CONTAINER_NAME = "agentsea-agent";
/** Docker registry hosting AgentSea agent images (see todo.md until first-party mirrors exist). */
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
    "_agentsea_restarts=0",
    "_agentsea_max=10",
    'while [ "$_agentsea_restarts" -lt "$_agentsea_max" ]; do',
    `  ${cmd}`,
    "  _agentsea_exit=$?",
    '  if [ "$_agentsea_exit" -eq 0 ]; then break; fi',
    "  _agentsea_restarts=$((_agentsea_restarts + 1))",
    '  printf "\\n[agentsea] Agent exited with code %d. Restarting in 5s (%d/%d)...\\n" "$_agentsea_exit" "$_agentsea_restarts" "$_agentsea_max" >&2',
    "  sleep 5",
    "done",
    'if [ "$_agentsea_restarts" -ge "$_agentsea_max" ]; then',
    '  printf "\\n[agentsea] Agent crashed %d times. Giving up.\\n" "$_agentsea_max" >&2',
    "fi",
    'exit "${_agentsea_exit:-0}"',
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

// ── Recursive agentsea helpers ──────────────────────────────────────────────────

/** Install the agentsea CLI on a remote VM. */
export async function installAgentseaCli(runner: CloudRunner): Promise<void> {
  logStep("Installing agentsea CLI on VM...");
  // Build PATH explicitly — non-interactive bash skips .bashrc (PS1 guard),
  // and some platforms (Sprite) have a broken bun shim that finds via
  // `command -v` but doesn't actually work. We prepend all known bun
  // locations so the real binary is found first, then test `bun --version`
  // (not just existence) and install bun fresh if it doesn't work.
  const installCmd = [
    'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"',
    'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/.sprite/languages/bun/bin:/usr/local/bin:$PATH"',
    'if ! bun --version >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"; fi',
    `curl -fsSL ${getCdnOrigin()}/cli/install.sh | bash`,
  ].join("; ");
  const result = await asyncTryCatch(() =>
    withRetry(`${AGENTSEA_CLI} CLI install`, () => wrapSshCall(runner.runServer(installCmd)), 2, 5),
  );
  if (!result.ok) {
    logWarn("Agentsea CLI install failed — recursive spawning will not be available on this VM");
  } else {
    logAlwaysInfo("Agentsea CLI installed on VM");
  }
}

/** Copy local cloud credentials to the remote VM for recursive spawning. */
export async function delegateCloudCredentials(runner: CloudRunner): Promise<void> {
  logStep("Delegating cloud credentials to VM...");

  const filesToDelegate: {
    localPath: string;
    remotePath: string;
  }[] = [];

  // Delegate ALL cloud credentials so the child VM can agentsea on any cloud,
  // not just the one the parent is running on.
  const cloudNames = [
    "hetzner",
    "digitalocean",
    "aws",
    "gcp",
    "sprite",
  ];
  for (const cloud of cloudNames) {
    const cloudConfigPath = getAgentseaCloudConfigPath(cloud);
    if (existsSync(cloudConfigPath)) {
      filesToDelegate.push({
        localPath: cloudConfigPath,
        remotePath: `~/.config/agentsea/${cloud}.json`,
      });
    }
  }

  // Saved The Grid API key (~/.config/agentsea/thegrid.json) for child spawns
  const orConfigPath = getAgentseaCloudConfigPath("thegrid");
  if (existsSync(orConfigPath)) {
    filesToDelegate.push({
      localPath: orConfigPath,
      remotePath: "~/.config/agentsea/thegrid.json",
    });
  }

  if (filesToDelegate.length === 0) {
    logWarn("No credentials to delegate — child spawns may require manual auth");
    return;
  }

  // Ensure config dir exists on VM
  const mkdirResult = await asyncTryCatch(() =>
    runner.runServer("mkdir -p ~/.config/agentsea && chmod 700 ~/.config/agentsea"),
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

/** Get parent_id and depth fields for agentsea records (set when running inside a child VM). */
function getParentFields(): {
  parent_id?: string;
  depth?: number;
} {
  const parentId = process.env.AGENTSEA_PARENT_ID;
  const depth = Number(process.env.AGENTSEA_DEPTH) || 0;
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

/** Build and persist a AgentseaRecord for a newly-created server. */
function recordAgentsea(agentseaId: string, agentName: string, cloudName: string, connection: VMConnection): void {
  const agentseaName = process.env.AGENTSEA_NAME_KEBAB || process.env.AGENTSEA_NAME || undefined;
  upsertAgentseaRecord({
    id: agentseaId,
    agent: agentName,
    cloud: cloudName,
    timestamp: new Date().toISOString(),
    ...(agentseaName
      ? {
          name: agentseaName,
        }
      : {}),
    ...getParentFields(),
    connection,
    provision_phase: "vm_created",
    provision_status: "in_progress",
    provision_updated_at: new Date().toISOString(),
  });
}

/** Append recursive-agentsea env vars to the envPairs array when --beta recursive is active. */
export function appendRecursiveEnvVars(envPairs: string[], agentseaId: string): void {
  const currentDepth = Number(process.env.AGENTSEA_DEPTH) || 0;
  envPairs.push(`AGENTSEA_PARENT_ID=${agentseaId}`);
  envPairs.push(`AGENTSEA_DEPTH=${currentDepth + 1}`);
  envPairs.push("AGENTSEA_BETA=recursive");
}

/** Options for runOrchestration (used in tests to inject mock dependencies). */
export interface OrchestrationOptions {
  tryTarball?: (runner: CloudRunner, agentName: string) => Promise<boolean>;
  getApiKey?: (agentSlug?: string, cloudSlug?: string) => Promise<string>;
  /** For tests: supply a cloud when exercising resumeOrchestrationFromRecord without provider APIs. */
  testResumeCloud?: CloudOrchestrator;
  /** For tests: return from resumeOrchestrationFromRecord immediately before runPostInstallPhase (avoids process.exit). */
  testResumeStopBeforePostInstall?: boolean;
  /** Resume path: skip agent configure() when checkpoint is agent_configured or later (#28). */
  skipAgentConfigure?: boolean;
}

/**
 * Load a preferred model from ~/.config/agentsea/preferences.json.
 * Format: { "models": { "codex": "<Grid catalogue id>", "openclaw": "<Grid catalogue id>" } }
 * Returns null if no preference is set or the file doesn't exist.
 */
const PreferencesSchema = v.object({
  models: v.optional(v.record(v.string(), v.string())),
  starPromptShownAt: v.optional(v.string()),
});

function loadPreferredModel(agentName: string): string | null {
  const result = tryCatch(() => {
    const raw = JSON.parse(readFileSync(getAgentseaPreferencesPath(), "utf-8"));
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
    process.env.AGENTSEA_NON_INTERACTIVE === "1" ||
    process.env.AGENTSEA_HEADLESS === "1" ||
    process.env.AGENTSEA_SKIP_MODEL_PROMPT === "1"
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

function shouldOfferHeartbeatModelPicker(agentName: string): boolean {
  if (!agentSupportsHeartbeatModel(agentName)) {
    return false;
  }
  if (!isInteractiveTTY()) {
    return false;
  }
  if (
    process.env.AGENTSEA_NON_INTERACTIVE === "1" ||
    process.env.AGENTSEA_HEADLESS === "1" ||
    process.env.AGENTSEA_SKIP_MODEL_PROMPT === "1"
  ) {
    return false;
  }
  if (process.env[AGENTSEA_HEARTBEAT_MODEL_ENV]) {
    return false;
  }
  return true;
}

async function ensureGridModelFunded(apiKey: string, modelId: string, catalog: Awaited<ReturnType<typeof fetchGridModelCatalog>>): Promise<void> {
  const entry = catalog.entries.find((row) => row.id === modelId);
  if (entry?.funded) {
    return;
  }
  const funded = await ensureGridModelHasCredits(apiKey, modelId);
  if (!funded) {
    logWarn(`Provisioning cancelled — add Grid credits for "${modelId}" and try again.`);
    throw new Error("Grid model has no consumption balance");
  }
}

/** Resolve MODEL_ID → validated id; optionally prompt against `GET …/models` when interactive. */
async function resolveProvisionModelId(
  agentName: string,
  agent: AgentConfig,
  apiKey: string,
  authRetried = false,
): Promise<string | undefined> {
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

  const needsModelCatalog =
    shouldOfferGridModelPicker(agent, preference) || shouldOfferHeartbeatModelPicker(agentName);
  if (needsModelCatalog) {
    const catalog = await runWithSpinner("Fetching models from The Grid…", async () => fetchGridModelCatalog(apiKey));
    if (catalog.authFailed) {
      logWarn("The Grid API key was rejected — check THEGRID_API_KEY (and THEGRID_API_URL if set).");
      if (
        !authRetried &&
        isInteractiveTTY() &&
        process.env.AGENTSEA_NON_INTERACTIVE !== "1" &&
        process.env.AGENTSEA_HEADLESS !== "1"
      ) {
        logWarn(
          "If you removed your key, unset THEGRID_API_KEY or run with AGENTSEA_REAUTH=1 — a stale key may still be exported from ~/.agentsearc in your shell.",
        );
        delete process.env.THEGRID_API_KEY;
        const freshKey = await getOrPromptApiKey(agentName);
        return resolveProvisionModelId(agentName, agent, freshKey, true);
      }
    }
    if (catalog.entries.length > 0) {
      const catalogueIds = catalog.entries.map((entry) => entry.id);
      const fallback =
        agent.modelDefault && catalogueIds.includes(agent.modelDefault) ? agent.modelDefault : catalogueIds[0]!;
      const suggested =
        rawModelId && catalogueIds.includes(rawModelId) ? rawModelId : fallback;

      if (shouldOfferGridModelPicker(agent, preference)) {
        const picked = await promptHarnessGridModels(catalog.entries, suggested, agentName);
        if (picked.primary && validateModelId(picked.primary)) {
          await ensureGridModelFunded(apiKey, picked.primary, catalog);
          rawModelId = picked.primary;
        }
        if (picked.utility && validateModelId(picked.utility)) {
          await ensureGridModelFunded(apiKey, picked.utility, catalog);
          process.env[AGENTSEA_HEARTBEAT_MODEL_ENV] = picked.utility;
        }
      } else if (shouldOfferHeartbeatModelPicker(agentName)) {
        const picked = await promptHarnessGridModels(catalog.entries, suggested, agentName, {
          heartbeatOnly: true,
        });
        if (picked.utility && validateModelId(picked.utility)) {
          await ensureGridModelFunded(apiKey, picked.utility, catalog);
          process.env[AGENTSEA_HEARTBEAT_MODEL_ENV] = picked.utility;
        }
      }
    } else if (catalog.publicCatalogFailed && catalog.authFailed) {
      logWarn("Could not load model catalogue from The Grid — continuing with CLI defaults.");
    } else if (catalog.publicCatalogFailed) {
      logWarn("Could not load the public model catalogue — continuing with CLI defaults.");
    } else {
      logWarn("No Grid models are listed for this environment — continuing with CLI defaults.");
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

  let failureAgentseaId: string | undefined;

  const orchestrationResult = await asyncTryCatch(async () => {
    await cloud.authenticate();
    trackFunnel("funnel_cloud_authed");

    if (cloud.ensureReadyBeforeSizing) {
      await cloud.ensureReadyBeforeSizing();
    }

    // Local runs reuse the prior row for the same agent+name so retries upsert
    // instead of piling up duplicate history entries (issue #21).
    let agentseaId = generateAgentseaId();
    if (isLocalRuntime(cloud)) {
      const localName = process.env.AGENTSEA_NAME_KEBAB || process.env.AGENTSEA_NAME || undefined;
      const reuseId = findReusableLocalRecordId(agentName, localName);
      if (reuseId) {
        agentseaId = reuseId;
      }
    }
    failureAgentseaId = agentseaId;
    const stubTs = new Date().toISOString();
    writeProvisionCheckpoint({
      id: agentseaId,
      agent: agentName,
      cloud: cloud.cloudName,
      timestamp: stubTs,
      provision_phase: "pending",
      provision_status: "in_progress",
      provision_updated_at: stubTs,
      ...getParentFields(),
    });

    const betaFeatures = new Set((process.env.AGENTSEA_BETA ?? "").split(",").filter(Boolean));
    const fastMode = process.env.AGENTSEA_FAST === "1" || betaFeatures.has("parallel");
    const useTarball = fastMode || betaFeatures.has("tarball");

    if ((useTarball || cloud.skipAgentInstall) && !isLocalRuntime(cloud) && (agent.cloudInitTier === "minimal" || !agent.cloudInitTier)) {
      cloud.skipCloudInit = true;
    }

    await cloud.promptSize();
    patchAgentseaRecord(agentseaId, {
      provision_phase: "cloud_authenticated",
      provision_status: "in_progress",
    });

    acquireHeadlessProvisionLock();

    const serverName = await cloud.getServerName();

    if (fastMode && !isLocalRuntime(cloud)) {
      const keepAlive = setInterval(() => {}, 60_000);

      const serverBootPromise = (async () => {
        patchAgentseaRecord(agentseaId, {
          provision_phase: "vm_creating",
          provision_status: "in_progress",
        });
        const conn = await cloud.createServer(serverName);
        recordAgentsea(agentseaId, agentName, cloud.cloudName, conn);
        patchAgentseaRecord(agentseaId, {
          provision_phase: "vm_waiting",
          provision_status: "in_progress",
        });
        await cloud.waitForReady();
        patchAgentseaRecord(agentseaId, {
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
        patchAgentseaRecord(agentseaId, {
          provision_phase: "vm_creating",
          provision_status: "in_progress",
        });
        const connection = await cloud.createServer(serverName);
        recordAgentsea(agentseaId, agentName, cloud.cloudName, connection);
        patchAgentseaRecord(agentseaId, {
          provision_phase: "vm_waiting",
          provision_status: "in_progress",
        });
        await cloud.waitForReady();
        patchAgentseaRecord(agentseaId, {
          provision_phase: "vm_ready",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_vm_ready");

      if (apiKeyResult.status === "rejected") {
        throw apiKeyResult.reason;
      }
      const apiKey = apiKeyResult.value;
      patchAgentseaRecord(agentseaId, {
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
        appendRecursiveEnvVars(envPairs, agentseaId);
      }
      const envContent = generateEnvConfig(envPairs);

      if (cloud.skipAgentInstall) {
        logInfo("Snapshot boot — skipping agent install");
      } else {
        patchAgentseaRecord(agentseaId, {
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
        patchAgentseaRecord(agentseaId, {
          provision_phase: "agent_installed",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_install_completed");

      clearInterval(keepAlive);
      const envSoft: string[] = [];
      patchAgentseaRecord(agentseaId, {
        provision_phase: "env_injecting",
        provision_status: "in_progress",
      });
      await injectEnvVars(cloud, envContent, envSoft);
      patchAgentseaRecord(agentseaId, {
        provision_phase: "env_injected",
        provision_status: "in_progress",
      });
      patchAgentseaRecord(agentseaId, {
        provision_phase: "post_install",
        provision_status: "in_progress",
      });
      await runPostInstallPhase(cloud, agent, agentName, apiKey, modelId, agentseaId, envSoft, options);
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
      patchAgentseaRecord(agentseaId, {
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
      patchAgentseaRecord(agentseaId, {
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
      recordAgentsea(agentseaId, agentName, cloud.cloudName, connection);

      patchAgentseaRecord(agentseaId, {
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
      patchAgentseaRecord(agentseaId, {
        provision_phase: "vm_ready",
        provision_status: "in_progress",
      });
      trackFunnel("funnel_vm_ready");

      const envPairs = agent.envVars(apiKey);
      if (modelId && agent.modelEnvVar) {
        envPairs.push(`${agent.modelEnvVar}=${modelId}`);
      }
      if (betaFeatures.has("recursive")) {
        appendRecursiveEnvVars(envPairs, agentseaId);
      }
      const envContent = generateEnvConfig(envPairs);

      if (cloud.skipAgentInstall) {
        logInfo("Snapshot boot — skipping agent install");
      } else {
        patchAgentseaRecord(agentseaId, {
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
        patchAgentseaRecord(agentseaId, {
          provision_phase: "agent_installed",
          provision_status: "in_progress",
        });
      }
      trackFunnel("funnel_install_completed");

      const envSoft: string[] = [];
      patchAgentseaRecord(agentseaId, {
        provision_phase: "env_injecting",
        provision_status: "in_progress",
      });
      await injectEnvVars(cloud, envContent, envSoft);
      patchAgentseaRecord(agentseaId, {
        provision_phase: "env_injected",
        provision_status: "in_progress",
      });
      patchAgentseaRecord(agentseaId, {
        provision_phase: "post_install",
        provision_status: "in_progress",
      });
      await runPostInstallPhase(cloud, agent, agentName, apiKey, modelId, agentseaId, envSoft, options);
    }
  });

  if (!orchestrationResult.ok) {
    if (failureAgentseaId) {
      patchAgentseaRecord(failureAgentseaId, {
        provision_status: "failed",
        provision_error: shortProvisionError(orchestrationResult.error),
      });
    }
    throw orchestrationResult.error;
  }
}

/** Continue provisioning from last recorded phase (DigitalOcean / Hetzner SSH clouds). */
export async function resumeOrchestrationFromRecord(
  record: AgentseaRecord,
  manifest: Manifest,
  options?: OrchestrationOptions,
): Promise<void> {
  if (!manifest.agents[record.agent]) {
    throw new Error(`Unknown agent in history: ${record.agent}`);
  }

  patchAgentseaRecord(record.id, {
    provision_status: "in_progress",
    provision_error: undefined,
  });

  const cloud = options?.testResumeCloud ?? (await buildCloudOrchestratorForResume(record));
  if (!cloud) {
    throw new Error(
      `Resume needs a saved SSH connection. Unsupported or missing cloud connection — try ${AGENTSEA_CLI} fix.`,
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
  const betaFeatures = new Set((process.env.AGENTSEA_BETA ?? "").split(",").filter(Boolean));
  const useTarball =
    process.env.AGENTSEA_FAST === "1" || betaFeatures.has("parallel") || betaFeatures.has("tarball");

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
    patchAgentseaRecord(record.id, {
      provision_phase: "vm_waiting",
    });
    await cloud.waitForReady();
    patchAgentseaRecord(record.id, {
      provision_phase: "vm_ready",
    });
  }

  if (phaseIdx < provisionPhaseIndex("agent_installed")) {
    if (cloud.skipAgentInstall) {
      logInfo("Snapshot boot — skipping agent install");
    } else {
      patchAgentseaRecord(record.id, {
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
    patchAgentseaRecord(record.id, {
      provision_phase: "agent_installed",
    });
  }

  const envSoft: string[] = [];
  if (phaseIdx < provisionPhaseIndex("env_injected")) {
    patchAgentseaRecord(record.id, {
      provision_phase: "env_injecting",
    });
    await injectEnvVars(cloud, envContent, envSoft);
    patchAgentseaRecord(record.id, {
      provision_phase: "env_injected",
    });
  }

  patchAgentseaRecord(record.id, {
    provision_phase: "post_install",
  });
  if (options?.testResumeStopBeforePostInstall) {
    return;
  }
  const skipConfigure = phaseIdx >= provisionPhaseIndex("agent_configured");
  await runPostInstallPhase(cloud, agent, record.agent, apiKey, modelId, record.id, envSoft, {
    ...options,
    skipAgentConfigure: skipConfigure,
  });
}

/** Write env content to ~/.agentsearc and ensure all shell rc files source it. */
export async function injectEnvVarsToRunner(runner: CloudRunner, envContent: string): Promise<boolean> {
  logStep("Setting up environment variables...");
  const envB64 = Buffer.from(envContent).toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(envB64)) {
    throw new Error("Unexpected characters in base64 output");
  }

  const envSetupCmd =
    `printf '%s' '${envB64}' | base64 -d > ~/.agentsearc && chmod 600 ~/.agentsearc; ` +
    "for _rc in ~/.bashrc ~/.profile ~/.bash_profile ~/.zshrc; do " +
    `grep -q 'source ~/.agentsearc' "$_rc" 2>/dev/null || echo '[ -f ~/.agentsearc ] && source ~/.agentsearc' >> "$_rc"; ` +
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
      `$bytes = [Convert]::FromBase64String('${envB64}'); ` + `[IO.File]::WriteAllBytes("$HOME/.agentsearc", $bytes)`;
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
  agentseaId: string,
  provisionSoftFailures: string[],
  options?: OrchestrationOptions,
): Promise<void> {
  const soft = provisionSoftFailures;
  // ── Repo clone + agentsea.md (--repo mode) ────────────────────────────────
  // Built-in steps (github, auto-update, etc.) come from the CLI --steps
  // flag, not from agentsea.md.  agentsea.md only handles custom setup (OAuth,
  // MCP servers, setup commands).
  let agentseaMdConfig: import("./agentsea-md.js").AgentseaMdConfig | null = null;
  let repoCloned = false;
  const repoArg = process.env.AGENTSEA_REPO;
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
        const { readRemoteAgentseaMd } = await import("./agentsea-md.js");
        agentseaMdConfig = await readRemoteAgentseaMd(cloud.runner);
        if (agentseaMdConfig) {
          logInfo(`Template loaded: ${agentseaMdConfig.name ?? repoArg}`);
        }
      }
    }
  }

  // Parse enabled setup steps
  let enabledSteps: Set<string> | undefined;
  const stepsEnv = process.env.AGENTSEA_ENABLED_STEPS;
  const isHeadless = process.env.AGENTSEA_HEADLESS === "1";
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
  if (agent.configure && !options?.skipAgentConfigure) {
    const configLabel = `${agent.name}: remote configuration…`;
    const runConfigure = () =>
      withRetry("agent config", () => wrapSshCall(agent.configure!(apiKey, modelId, enabledSteps)), 2, 5);
    const configResult = await asyncTryCatch(() => {
      if (isAgentseaVerbose()) {
        logAlwaysStep(configLabel);
        return runConfigure();
      }
      return runWithSpinner(
        configLabel,
        async (handle) => {
          handle.setDetail("writing config files");
          return runConfigure();
        },
        {
          doneMessage: `${agent.name} configured`,
          formatMessage: ({ base, detail, elapsedSec }) => {
            const phase =
              elapsedSec < 20
                ? detail || "applying settings"
                : elapsedSec < 90
                  ? "merging provider config"
                  : "finishing setup";
            return `${base} — ${phase}`;
          },
        },
      );
    });
    if (!configResult.ok) {
      logWarn("Agent configuration failed (continuing with defaults)");
      soft.push("agent_configure");
    } else {
      patchAgentseaRecord(agentseaId, {
        provision_phase: "agent_configured",
      });
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
        agentseaId,
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
      agentseaId,
    );
  }

  // Security scan cron
  if (!securityScanDisabled(cloud) && (!enabledSteps || enabledSteps.has("security-scan"))) {
    await setupSecurityScan(cloud.runner);
  }

  // Agentsea CLI + skill injection (recursive agentsea)
  // The "agentsea" step is defaultOn when --beta recursive is active, so it should
  // run when no explicit steps are selected (!enabledSteps) AND the beta flag is set.
  const betaFeaturesPost = new Set((process.env.AGENTSEA_BETA ?? "").split(",").filter(Boolean));
  if (
    !isLocalRuntime(cloud) &&
    betaFeaturesPost.has("recursive") &&
    (!enabledSteps || enabledSteps.has("agentsea"))
  ) {
    await installAgentseaCli(cloud.runner);
    await delegateCloudCredentials(cloud.runner);
    await injectAgentseaSkill(cloud.runner, agentName);
  }

  // Skill installation (--beta skills)
  const selectedSkillsEnv = process.env.AGENTSEA_SELECTED_SKILLS;
  if (selectedSkillsEnv && !isLocalRuntime(cloud)) {
    const skillIds = selectedSkillsEnv.split(",").filter(Boolean);
    if (skillIds.length > 0) {
      const { loadManifest } = await import("../manifest.js");
      const manifestForSkills = await loadManifest();
      if (manifestForSkills.skills) {
        const { installSkills } = await import("./skills.js");
        await installSkills(cloud.runner, manifestForSkills, agentName, skillIds);

        // Append skill env vars to .agentsearc so MCP servers can resolve ${VAR} at runtime
        const skillEnvPairs = (process.env.AGENTSEA_SKILL_ENV_PAIRS ?? "").split(",").filter(Boolean);
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
            const payload = `\n# [agentsea:skills]\n${envLines}\n`;
            const payloadB64 = Buffer.from(payload).toString("base64");
            if (!/^[A-Za-z0-9+/=]+$/.test(payloadB64)) {
              logWarn("Unexpected characters in skill env payload base64");
            } else {
              await asyncTryCatch(() =>
                cloud.runner.runServer(`printf '%s' '${payloadB64}' | base64 -d >> ~/.agentsearc`),
              );
            }
          }
        }
      }
    }
  }

  // Apply agentsea.md custom setup (after built-in steps, before pre-launch)
  if (agentseaMdConfig) {
    const { applyAgentseaMdSetup } = await import("./agentsea-md.js");
    await applyAgentseaMdSetup(cloud.runner, agentseaMdConfig, agentName);
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
  let t3PairingWatcher: { stop: () => void } | undefined;
  let hermesDashboardReady = true;
  if (agentName === "hermes") {
    hermesDashboardReady = await ensureHermesDashboard(cloud.runner);
    if (!hermesDashboardReady) {
      logWarn(
        isLocalRuntime(cloud)
          ? "Hermes dashboard is not running — skipping browser. The TUI still works; run `hermes dashboard` or try agentsea list → Open Dashboard."
          : "Hermes dashboard is not running on the server — skipping browser. The TUI works; try again later via agentsea list → Open Dashboard.",
      );
      soft.push("hermes_dashboard");
    }
  }
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
        if (tunnelCfg.browserUrl && hermesDashboardReady) {
          const url = tunnelCfg.browserUrl(tunnelHandle.localPort);
          if (url) {
          logAlwaysStep("Web dashboard — Control UI");
          logDashboardAuthHandoff(url, tunnelCfg.logGatewayToken);
          openBrowser(url);
          }
        } else if (tunnelCfg.requiresPairing) {
          logAlwaysStep("T3 Code — browser pairing");
          logT3PairingHandoff(tunnelHandle.localPort);
          t3PairingWatcher = startT3PairingBrowserWatcher({
            ip: conn.host,
            user: conn.user,
            sshKeyOpts: getSshKeyOpts(keys),
            localPort: tunnelHandle.localPort,
          });
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
      if (agent.tunnel.browserUrl && hermesDashboardReady) {
        const url = agent.tunnel.browserUrl(agent.tunnel.remotePort);
        if (url) {
          logAlwaysStep("Web dashboard — Control UI");
          logDashboardAuthHandoff(url, tunnelCfg.logGatewayToken);
          openBrowser(url);
        }
      } else if (tunnelCfg.requiresPairing) {
        logAlwaysStep("T3 Code — browser pairing");
        logT3PairingHandoff(agent.tunnel.remotePort);
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
    if (tunnelHandle) {
      tunnelMeta.tunnel_local_port = String(tunnelHandle.localPort);
    }
    saveMetadata(tunnelMeta, agentseaId);
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
          `source ~/.agentsearc 2>/dev/null; ${ocPath}; openclaw pairing approve telegram ${escaped}`,
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

  if (agent.preLaunchMsg && hermesDashboardReady) {
    process.stderr.write("\n");
    logAlwaysInfo(`Tip: ${agent.preLaunchMsg}`);
  }

  // Launch agent
  logAlwaysInfo(`Agent setup complete — ${agent.name} is ready on ${cloud.cloudLabel}`);
  process.stderr.write("\n");

  const manifestForNextSteps = await asyncTryCatchIf(isOperationalError, () =>
    import("../manifest.js").then((m) => m.loadManifest()),
  );
  if (manifestForNextSteps.ok) {
    const { writeAgentNextSteps } = await import("./next-steps.js");
    writeAgentNextSteps(agentName, manifestForNextSteps.data, { headless: isHeadless });
  }

  // Final funnel event — pipeline completed all the way to handoff.
  // Downstream analysis: (funnel_started count) - (funnel_handoff count) =
  // total drop-off. Per-step counts reveal where the drop-off happens.
  trackFunnel("funnel_handoff", {
    headless: process.env.AGENTSEA_HEADLESS === "1",
  });

  // When --repo cloned successfully, launch the agent inside the cloned
  // project directory. Gate on the actual clone outcome rather than the flag
  // so an invalid slug or clone failure doesn't leave the agent trying to cd
  // into a non-existent dir.
  const baseLaunchCmd = agent.launchCmd();
  const launchCmd = repoCloned ? `cd ~/project && ${baseLaunchCmd}` : baseLaunchCmd;
  saveLaunchCmd(launchCmd, agentseaId);
  finalizeProvisionSuccess(agentseaId, soft);

  // In headless mode, provisioning is done — skip the interactive session.
  // If --prompt was provided and the agent has a promptCmd, execute the prompt on the VM.
  if (isHeadless) {
    const headlessPrompt = process.env.AGENTSEA_PROMPT;
    if (headlessPrompt && agent.promptCmd) {
      logAlwaysInfo("Headless mode — running prompt on provisioned VM...");
      const promptRunCmd = wrapHeadlessPromptCmd(agent.promptCmd(headlessPrompt));
      const promptResult = await asyncTryCatch(() => cloud.runner.runServer(promptRunCmd, 600));
      if (!promptResult.ok) {
        logError(`Headless prompt failed: ${getErrorMessage(promptResult.error)}`);
        process.exit(1);
      }
      if (process.env.AGENTSEA_USE_CHAT_INPUT_TEST !== "1") {
        const toolAssert = await asyncTryCatch(() =>
          cloud.runner.runServer(assertToolE2eFileCmd(), 30),
        );
        if (!toolAssert.ok) {
          logError(
            `Headless tool E2E failed: agent did not create ${TOOL_E2E_FILE} — ${getErrorMessage(toolAssert.error)}`,
          );
          process.exit(1);
        }
        logAlwaysInfo("Tool E2E file assertion passed");
      }
      logAlwaysInfo("Prompt execution completed");
    } else {
      logAlwaysInfo("Headless mode — provisioning complete. Skipping interactive session.");
    }
    if (tunnelHandle) {
      logAlwaysInfo(
        "Closing SSH tunnel to the dashboard — localhost URLs only work while agentsea holds the tunnel open.",
      );
      logAlwaysInfo(
        `The gateway on your VM keeps running. Re-open the UI: run ${AGENTSEA_CLI} list → pick this server → "Open Dashboard".`,
      );
      tunnelHandle.stop();
    }
    if (!isLocalRuntime(cloud)) {
      await pullChildHistory(cloud.runner, agentseaId);
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

  const tunnelPortExport = tunnelHandle
    ? `export AGENTSEA_TUNNEL_LOCAL_PORT=${tunnelHandle.localPort}; `
    : "";
  const sessionCmd = isLocalRuntime(cloud)
    ? `${tunnelPortExport}${launchCmd}`
    : wrapWithRestartLoop(`${tunnelPortExport}${launchCmd}`);

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
    logAlwaysInfo(`Reconnect manually: ${AGENTSEA_CLI} last`);
  }

  if (tunnelHandle) {
    tunnelHandle.stop();
  }
  t3PairingWatcher?.stop();

  // Pull child's agentsea history back to the parent for `agentsea tree`.
  // Fire-and-forget — never delay exit for a convenience feature.
  // process.exit() below kills any in-flight SSH calls.
  if (!isLocalRuntime(cloud)) {
    pullChildHistory(cloud.runner, agentseaId).catch(() => {});
  }

  process.exit(exitCode);
}

/**
 * Pull agentsea history from a child VM and merge it into local history.
 * First tells the child to recursively pull from ITS children via
 * `agentsea pull-history`, then downloads the child's history.json.
 * This enables `agentsea tree` to show the full recursive hierarchy.
 */
async function pullChildHistory(runner: CloudRunner, parentAgentseaId: string): Promise<void> {
  const result = await asyncTryCatch(async () => {
    const tmpPath = `${getTmpDir()}/child-history-${parentAgentseaId}.json`;

    // Recursive pull: tell the child to pull from ALL its children first.
    const recursePull = await asyncTryCatch(() =>
      runner.runServer(
        'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"; agentsea pull-history 2>/dev/null || true',
        120,
      ),
    );
    if (!recursePull.ok) {
      logDebug("Recursive history pull skipped");
    }

    // Copy the child's history to a temp location then download
    const copyResult = await asyncTryCatch(() =>
      runner.runServer(
        "cp ~/.config/agentsea/history.json /tmp/_agentsea_history.json 2>/dev/null || cp ~/.config/agentsea/history.json /tmp/_agentsea_history.json 2>/dev/null || echo '{}'  > /tmp/_agentsea_history.json",
      ),
    );
    if (!copyResult.ok) {
      return;
    }

    await runner.downloadFile("/tmp/_agentsea_history.json", tmpPath);

    const json = readFileSync(tmpPath, "utf-8");
    const ChildHistorySchema = v.object({
      version: v.optional(v.number()),
      records: v.array(AgentseaRecordSchema),
    });
    const parsed = parseJsonWith(json, ChildHistorySchema);
    if (!parsed || parsed.records.length === 0) {
      return;
    }

    const validRecords: AgentseaRecord[] = [];
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
      mergeChildHistory(parentAgentseaId, validRecords);
      logInfo(`Pulled ${validRecords.length} agentsea record(s) from child VM`);
    }

    tryCatch(() => unlinkSync(tmpPath));
  });

  if (!result.ok) {
    logDebug(`Could not pull child history: ${getErrorMessage(result.error)}`);
  }
}
