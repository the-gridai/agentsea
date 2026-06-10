# AgentSea E2E tests

End-to-end tests provision real cloud VMs (or sandboxes), run the AgentSea CLI headlessly, wait for remote install (`.agentsearc`), run per-agent checks and optional LLM “input tests”, then tear down.

## DigitalOcean: all agents, one droplet at a time

Use this when you want to confirm every **manifest-implemented** agent on DigitalOcean, sequentially (safe for account droplet limits).

**Prerequisites**

- `bun` (used to run the CLI entrypoint)
- `node` (only needed for `--agents-from-manifest`)
- SSH private key on the **machine running E2E** that matches the droplet: same order as the CLI (`~/.ssh/agentsea_ed25519`, then `id_ed25519` / `id_rsa` / `id_ecdsa`, up to three `-i` keys). Without this, post-provision checks that SSH to `root@<ip>` will fail even though `agentsea` connected during provision.
- `THEGRID_API_KEY` — The Grid platform API key
- One of: `DIGITALOCEAN_ACCESS_TOKEN`, `DIGITALOCEAN_API_TOKEN`, or `DO_API_TOKEN`
- Optional: `MODEL_ID` (defaults for headless runs are set in [`lib/provision.sh`](lib/provision.sh))

**From repo root**

```bash
./sh/e2e/e2e.sh --cloud digitalocean --sequential \
  --agents-from-manifest digitalocean \
  --first-agent openclaw
```

Or via npm:

```bash
npm run e2e:do:sequential:manifest
```

Agent order follows `manifest.json`: non-disabled agents sorted by GitHub stars (descending). `--first-agent openclaw` runs OpenClaw first when that cell is implemented, then the rest without duplicating it.

**Explicit agent list (no manifest)**

Uses [`lib/common.sh`](lib/common.sh) `ALL_AGENTS` and strict verify coverage:

```bash
./sh/e2e/e2e.sh --cloud digitalocean --sequential
```

**List agents only** (no cloud calls):

```bash
node scripts/list-e2e-agents.mjs digitalocean --first openclaw
```

## Runtime and cost

- Each agent can take **many minutes** (provision + cloud-init + installs + optional LLM round-trip). A full sequential DigitalOcean run is often **hours**.
- Tunables: `PROVISION_TIMEOUT`, `INSTALL_WAIT`, `AGENT_TIMEOUT`, `INPUT_TEST_TIMEOUT` (see [`lib/common.sh`](lib/common.sh)); per-agent overrides exist for some agents (e.g. Junie, Hermes).
- Use `--fast` to pass `--fast` into the CLI (faster image/tarball path where supported).
- Use `--skip-input-test` to skip live LLM prompts (still runs provision + `.agentsearc` + binary/env checks). Cheaper and faster for smoke runs.
- Input-test transcript logging is enabled by default:
  - `INPUT_TEST_LOG_TRANSCRIPT=1` logs exact request prompt + raw response transcript for auditable runs (`0` disables).
  - `INPUT_TEST_LOG_MAX_LINES=0` logs full response (`N` truncates to first `N` lines).

**Full suite including LLM input tests** — omit `SKIP_INPUT_TEST` (default). Example:

```bash
export PATH="$HOME/.bun/bin:$PATH"
./sh/e2e/e2e.sh --cloud digitalocean --sequential \
  --agents-from-manifest digitalocean --first-agent openclaw 2>&1 | tee /tmp/agentsea-e2e-full.log
```

Recent fixes for common failures: DigitalOcean `cloud_exec` uses `~/.ssh/agentsea_ed25519` (see driver); Kilocode E2E expects `KILO_PROVIDER_TYPE` from `vendor-routing.ts` (`opentouter`, not `openrouter`); Codex uses `wire_api = "responses"` for current Codex + The Grid (`model_providers.opentouter`).
- Use `--skip-cleanup` to skip pre/post stale instance cleanup (not usually recommended).

## Failure and recovery (Tier D)

Mid-provision failures, bad credentials, capacity limits, timeouts, and SSH issues are documented in **[TIER_D_FAILURE_SCENARIOS.md](TIER_D_FAILURE_SCENARIOS.md)**. Use that doc for QA teardown steps and expected log patterns.

**Tool input tests (default):** [`lib/verify.sh`](lib/verify.sh) sends a prompt that requires the agent to **create** `/tmp/agentsea-e2e-tool.txt` containing `TOOL_E2E_OK` via file/shell tools. Chat-only replies do not pass. Set `USE_CHAT_INPUT_TEST=1` for the legacy stdout marker test (`AGENTSEA_E2E_OK`).

## Manifest-driven agents vs E2E coverage

`--agents-from-manifest <cloud>` includes every agent with `matrix["<cloud>/<slug>"] === "implemented"`. Each agent still needs verify (and optional input-test) handlers in [`lib/verify.sh`](lib/verify.sh). Agents without handlers will fail verification with “Unknown agent”.
