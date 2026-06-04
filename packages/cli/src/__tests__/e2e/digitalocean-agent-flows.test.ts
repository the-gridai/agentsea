/**
 * Real DigitalOcean E2E: provisions a VM per agent via `sh/e2e/e2e.sh`, runs verify
 * (and optional LLM input test). Requires SSH access from this machine to the droplet
 * using the same keys as the CLI (see `sh/e2e/README.md`).
 *
 * Opt-in only (default `npm test` skips these):
 *
 *   GRIDAGENTSEA_RUN_DO_E2E=1 THEGRID_API_KEY=... DIGITALOCEAN_ACCESS_TOKEN=... \\
 *     npm run test:cli:e2e:do
 *
 * Optional:
 *   GRIDAGENTSEA_E2E_AGENTS=codex,claude   # subset; default = all E2E slugs
 *   GRIDAGENTSEA_E2E_INPUT_TEST=1          # also run live LLM prompts (slower)
 *
 * Tests are serialized so Bun never provisions multiple droplets at once.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { canRunDigitalOceanE2e, e2eAgentListFromEnv } from "./e2e-agents.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const E2E_SH = join(REPO_ROOT, "sh", "e2e", "e2e.sh");

const e2eGate = canRunDigitalOceanE2e(E2E_SH);
const canRun = e2eGate.ok;

/** Serialize heavy E2E runs so parallel test workers do not overlap provisions. */
let serialChain: Promise<void> = Promise.resolve();
function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = serialChain.then(fn, fn);
  serialChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const PER_AGENT_MS = Number(process.env.GRIDAGENTSEA_E2E_PER_AGENT_TIMEOUT_MS ?? 90 * 60 * 1000);

async function runE2eForAgent(agent: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const inputTest = process.env.GRIDAGENTSEA_E2E_INPUT_TEST === "1";
  const extraFlags = inputTest ? [] : ["--skip-input-test"];
  const proc = Bun.spawn({
    cmd: [
      "bash",
      E2E_SH,
      "--cloud",
      "digitalocean",
      "--sequential",
      "--fast",
      ...extraFlags,
      agent,
    ],
    cwd: REPO_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("DigitalOcean E2E (real provision + verify via e2e.sh)", () => {
  it.skipIf(canRun)("prints opt-in hint when GRIDAGENTSEA_RUN_DO_E2E is unset", () => {
    expect(e2eGate.reason.length).toBeGreaterThan(0);
    console.log(`\n[DigitalOcean E2E skipped] ${e2eGate.reason}\n`);
  });

  const agents = e2eAgentListFromEnv();
  for (const agent of agents) {
    it.skipIf(!canRun)(
      `${agent}: agentsea provision, install, verify on DigitalOcean`,
      async () => {
        await runSerial(async () => {
          const r = await runE2eForAgent(agent);
          if (r.exitCode !== 0) {
            console.error(`--- e2e stdout (${agent}) ---\n${r.stdout.slice(-12000)}`);
            console.error(`--- e2e stderr (${agent}) ---\n${r.stderr.slice(-12000)}`);
          }
          expect(
            r.exitCode,
            `e2e.sh failed for ${agent} (exit ${r.exitCode}). See stderr above; also ${REPO_ROOT}/sh/e2e/README.md`,
          ).toBe(0);
        });
      },
      { timeout: PER_AGENT_MS },
    );
  }
});
