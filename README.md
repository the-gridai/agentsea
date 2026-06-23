# AgentSea

**Launch any AI coding agent on any cloud — with one command.**

```bash
curl -fsSL https://agentsea.thegrid.ai/cli/install.sh | bash
agentsea claude digitalocean
```

That's it: AgentSea provisions a fresh, sandboxed environment in your own cloud
account, installs the agent, wires up inference through The Grid API, and drops
you into an interactive session.

## What is AgentSea?

AgentSea is a command-line launcher for AI coding agents. Instead of manually
spinning up a server, installing an agent, and configuring API keys every time,
you run a single command and AgentSea handles provisioning, setup, and
authentication for you.

Agents run on **your** infrastructure — your laptop or a VM in your own cloud
account — and reach LLMs through [The Grid](https://thegrid.ai), an
OpenAI-compatible inference API. You bring your cloud account and your Grid key;
AgentSea does the wiring.

## What it does

- **One-command launch** — `agentsea <agent> <cloud>` provisions a VM, installs
  the agent, and connects you.
- **Agent-agnostic** — OpenClaw, Claude Code, Codex, OpenCode, Hermes, Kilo Code,
  and more. Switch agents by changing one word.
- **Bring your own cloud** — DigitalOcean, Hetzner, AWS Lightsail, GCP, and local.
  Your account, your keys, your bill, your data.
- **Fully sandboxed** — each agent gets an isolated VM and credential boundary,
  so sessions never cross-talk.
- **Grid-backed inference** — all agents route LLM calls through The Grid API,
  so budgets, keys, and usage stay on-platform.
- **Run it locally** — no cloud account required; `agentsea <agent> local`
  installs the agent directly on your machine.

## Who is it for

- **Developers** who want to spin up a disposable AI coding agent without
  babysitting servers or copying API keys around.
- **Teams** who need each agent run isolated in its own VM and credential scope.
- **Anyone on The Grid** who wants to point an agent at Grid-backed inference in
  seconds.

## Quickstart

**1. Install the CLI** (macOS, Linux, or WSL — needs `bash`, `curl`, `ssh`, `jq`):

```bash
curl -fsSL https://agentsea.thegrid.ai/cli/install.sh | bash
```

**2. Authenticate with The Grid:**

```bash
agentsea auth login
```

This runs a browser/device login and saves a consumption key. (You can also set
`THEGRID_API_KEY` manually — create one at https://app.thegrid.ai.)

**3. Launch an agent:**

```bash
# On your own machine — no cloud account needed
agentsea claude local

# On a cloud VM (uses your provider token, e.g. DIGITALOCEAN_ACCESS_TOKEN)
agentsea claude digitalocean
```

**Useful commands:**

```bash
agentsea                 # interactive agent + cloud picker
agentsea agents          # list available agents
agentsea clouds          # list supported clouds
agentsea list            # browse and rerun past launches
agentsea status          # show live state of your servers
agentsea delete          # tear down a server
agentsea --help          # full reference
```

Cloud provider tokens use each provider's standard env var
(`DIGITALOCEAN_ACCESS_TOKEN`, `HCLOUD_TOKEN`, …). Run `agentsea <cloud>` to see
the setup steps for a specific provider.

## Repo layout

| Path            | What's inside                                                            |
| --------------- | ------------------------------------------------------------------------ |
| `manifest.json` | Public catalogue of agents, clouds, and their availability               |
| `sh/`           | Per-cloud bootstrap scripts (`sh/<cloud>/<agent>.sh`)                    |
| `assets/`       | Agent and cloud icons                                                    |
| `packages/cli`  | The `agentsea` command-line tool                                         |
| `packages/sdk`  | `@agentsea/sdk` — shared manifest types and loader                       |
| `packages/ui`   | The marketing site at [agentsea.thegrid.ai](https://agentsea.thegrid.ai) |

## Development

```bash
npm install

npm run dev          # marketing site → http://localhost:3011
npm run build:cli    # build the CLI bundle
npm run agentsea -- --help

npm run typecheck
npm run lint
npm run build
```

For local provisioning, copy `.env.example` → `.env` at the repo root (ignored by
git); `agentsea` loads it automatically when your shell is under this tree, or
set `AGENTSEA_ROOT` to point at it. See `todo.md` for the public roadmap and
`CONTRIBUTING.md` to get involved.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
