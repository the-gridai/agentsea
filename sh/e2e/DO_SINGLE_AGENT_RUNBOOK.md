# DigitalOcean Single-Agent Full E2E Runbook

Use this runbook to validate one agent end-to-end on DigitalOcean with:
- real VM provisioning,
- install and environment checks,
- live completion test (when the agent supports headless prompt mode),
- teardown and artifact collection.

This is written to be reusable for any agent slug, not just OpenCode.

## 1) Scope and success criteria

A full pass means all of the following are true:
1. DigitalOcean VM is created, reaches SSH-ready, and cloud-init completes.
2. Agent installs and `verify_agent` passes.
3. `run_input_test` passes (for agents that implement a real input test in `lib/verify.sh`).
4. No orphaned droplet remains after teardown.
5. Logs are captured and summarized.

If an agent intentionally skips input test (for example GUI-only/TUI-only handlers in `lib/verify.sh`), call that out explicitly in the report as a coverage gap.

## 2) Prerequisites

From repo root:

- `bun` and `node` installed.
- `THEGRID_API_KEY` set.
- One DO token set: `DIGITALOCEAN_ACCESS_TOKEN` or `DIGITALOCEAN_API_TOKEN` or `DO_API_TOKEN`.
- SSH key available to the runner and registered in DO (`~/.ssh/agentsea_ed25519` preferred).
- `packages/cli/src/index.ts` present (local CLI source run path).

Recommended:
- `AGENTSEA_VERBOSE=1` for richer diagnostics.
- `MODEL_ID` set to a valid The Grid catalog model where applicable.

## 3) Choose agent under test

Set once per run:

```bash
export AGENT=opencode
```

Examples for future agents:
- `AGENT=hermes`
- `AGENT=codex`
- `AGENT=junie`

## 4) Preflight checks (fail fast before spending)

```bash
cd /home/barney/spectral/agentsea
npm run build --workspace=@agentsea/cli
npm run test:cli
```

Credential sanity:

```bash
test -n "$THEGRID_API_KEY"
test -n "${DIGITALOCEAN_ACCESS_TOKEN:-${DIGITALOCEAN_API_TOKEN:-${DO_API_TOKEN:-}}}"
```

Optional SSH sanity:

```bash
test -f ~/.ssh/agentsea_ed25519
```

## 5) Happy-path full run (single agent, full checks)

This executes provision -> verify -> input test -> teardown for one agent:

```bash
cd /home/barney/spectral/agentsea
LOG="/tmp/agentsea-e2e-${AGENT}-do-$(date +%Y%m%d-%H%M%S).log"
./sh/e2e/e2e.sh --cloud digitalocean --sequential "${AGENT}" 2>&1 | tee "$LOG"
echo "LOG=$LOG"
```

Notes:
- Do **not** pass `--skip-input-test` for full validation.
- Add `--fast` if you want faster provision path:

```bash
./sh/e2e/e2e.sh --cloud digitalocean --sequential --fast "${AGENT}"
```

## 6) What to check in logs

Required checkpoints:
- Readiness checks all `READY`.
- Droplet create with ID and IP.
- SSH and cloud-init completion.
- `Verifying ${AGENT}` section shows all checks passed.
- `Input test: ${AGENT}` section passes (or explicitly skipped by design).
- Final summary reports pass for the agent.

Also capture:
- `e2e-agent-results.txt` generated at repo root by `e2e.sh`.
- Any per-agent stderr/stdout artifacts from temporary log dirs referenced by script output.

## 7) Failure triage workflow

When a run fails:
1. Identify failing phase: readiness / create / SSH / install / verify / input test.
2. Extract last 50-100 relevant log lines around first failure.
3. Classify root cause:
   - credential/auth,
   - cloud capacity/quota,
   - network/SSH reachability,
   - install/config regression,
   - agent completion regression.
4. Record fix-forward action and whether rerun is needed.

Use `TIER_D_FAILURE_SCENARIOS.md` for deliberate resilience tests (timeouts, bad creds, kill mid-run, etc.).

## 8) Teardown and orphan cleanup

`e2e.sh` performs teardown automatically per agent. If a run is interrupted:

```bash
agentsea delete --name <agentsea-name> --yes
```

If needed, remove stale headless lock:

```bash
rm -f ~/.config/agentsea/runs/headless-provision.lock
```

## 9) Agent onboarding checklist (for future agents)

Before using this runbook with a new agent, confirm:

1. Agent slug exists in `manifest.json` matrix for `digitalocean/<slug>` as `implemented`.
2. Agent exists in `sh/e2e/lib/common.sh` `ALL_AGENTS`.
3. `verify_<slug>` is implemented and wired in `verify_agent` case dispatch.
4. `input_test_<slug>` is implemented and wired in `run_input_test` case dispatch.
5. CLI config in `packages/cli/src/shared/agent-setup.ts` has:
   - `install`,
   - `envVars`,
   - `launchCmd`,
   - `promptCmd` (if headless completion should be tested),
   - safe `updateCmd` (no `${` in embedded wrapper path).

If item 4 is intentionally skipped (GUI-only flow), mark the run as partial coverage.
