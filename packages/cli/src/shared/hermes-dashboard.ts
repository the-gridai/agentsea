// Shared Hermes dashboard start/health checks (provision, reconnect, Open Dashboard).

import { asyncTryCatch } from "./result.js";
import { logInfo, logWarn } from "./ui.js";

export const HERMES_DASHBOARD_PORT = 9119;

type HermesDashboardRunner = {
  runServer(cmd: string, timeoutSecs?: number): Promise<void>;
};

/** Remote shell script: start `hermes dashboard` if needed and wait for `/health`. */
export function buildHermesDashboardStartScript(maxWaitSecs = 120): string {
  const port = HERMES_DASHBOARD_PORT;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  return [
    "source ~/.agentsearc 2>/dev/null",
    'export PATH="$HOME/.local/bin:$HOME/.hermes/hermes-agent/venv/bin:$PATH"',
    `curl -sf ${JSON.stringify(healthUrl)} >/dev/null 2>&1 && exit 0`,
    "_hermes_bin=$(command -v hermes) || { echo 'hermes not found in PATH' >&2; exit 1; }",
    "if command -v setsid >/dev/null 2>&1; then",
    `  setsid "$_hermes_bin" dashboard --port ${port} --host 127.0.0.1 --no-open > /tmp/hermes-dashboard.log 2>&1 < /dev/null &`,
    "else",
    `  nohup "$_hermes_bin" dashboard --port ${port} --host 127.0.0.1 --no-open > /tmp/hermes-dashboard.log 2>&1 < /dev/null &`,
    "fi",
    `for _i in $(seq 1 ${maxWaitSecs}); do`,
    `  curl -sf ${JSON.stringify(healthUrl)} >/dev/null 2>&1 && { echo "Hermes dashboard healthy after \${_i}s"; exit 0; }`,
    "  sleep 1",
    "done",
    `echo "Hermes dashboard failed to start within ${maxWaitSecs}s" >&2`,
    "tail -30 /tmp/hermes-dashboard.log 2>/dev/null || true",
    "exit 1",
  ].join("\n");
}

/** Quick probe — does not start the dashboard. */
export async function isHermesDashboardHealthy(runner: HermesDashboardRunner): Promise<boolean> {
  const script = `curl -sf "http://127.0.0.1:${HERMES_DASHBOARD_PORT}/health" >/dev/null 2>&1`;
  const result = await asyncTryCatch(() => runner.runServer(script, 20));
  return result.ok;
}

/**
 * Start the Hermes dashboard on the remote host if needed and wait until `/health` responds.
 * Returns false on failure (caller decides whether to block provisioning).
 */
export async function ensureHermesDashboard(
  runner: HermesDashboardRunner,
  maxWaitSecs = 120,
): Promise<boolean> {
  const result = await asyncTryCatch(() => runner.runServer(buildHermesDashboardStartScript(maxWaitSecs), maxWaitSecs + 30));
  if (result.ok) {
    logInfo(`Hermes web dashboard ready on :${HERMES_DASHBOARD_PORT}`);
    return true;
  }
  logWarn("Hermes web dashboard failed to start — TUI still available");
  return false;
}
