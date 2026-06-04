# One Command to Rule Them All: Why We Built AgentSea for the Agent Era

**TL;DR:** AgentSea is a CLI-first launcher that provisions AI coding agents on *your* cloud � DigitalOcean, Hetzner, AWS, GCP, Daytona, Sprite, or even your laptop � and wires them to [The Grid](https://thegrid.ai) for inference. No control plane. No vendor lock-in. Just `agentsea openclaw digitalocean` and you're in.

---

## The Problem Nobody Talks About

Everyone's shipping AI agents.

Claude Code. Codex. OpenClaw. Cursor CLI. OpenCode. Kilo Code. Hermes. Junie. Pi. T3 Code.

They're incredible. They're also a *nightmare* to deploy.

You want to run an agent on a real machine � not your MacBook while you're on a flight, not a shared dev box with twelve other engineers, not some opaque SaaS sandbox where your code lives on someone else's metal. You want:

- **Isolation** � one VM, one agent, one credential boundary
- **Your cloud** � your DigitalOcean account, your Hetzner bill, your data residency
- **One API key** � unified inference, budgets, and model routing through a single platform
- **A terminal** � because these agents are *CLI tools*, and you want to drive them interactively

So you do what every developer does: you write a bash script. Then another. Then a cloud-init file. Then you debug why Claude Code can't find Node on Ubuntu 24.04. Then you realize OpenClaw needs a gateway daemon. Then Junie can't follow HTTP 307 redirects. Then it's 2 AM and you're configuring LiteLLM proxies by hand.

We got tired of that. So we built **AgentSea**.

---

## What Is AgentSea?

AgentSea is the fastest way to deploy Grid-backed AI agents on infrastructure **you control**.

It's a single CLI � `agentsea` � that:

1. **Provisions** a VM on your chosen cloud provider
2. **Bootstraps** the agent via cloud-init userdata scripts
3. **Wires** The Grid API key and OpenAI-compatible endpoints into the agent
4. **Hands you an SSH session** so you can drive the agent in your terminal

That's it. No web UI. No proprietary control plane. No "sign up for our hosted agents" pitch.

```bash
curl -fsSL https://spawn.thegrid.ai/cli/install.sh | bash

agentsea                              # Interactive picker
agentsea openclaw digitalocean         # Launch directly
agentsea ls                            # List your spawns
agentsea matrix                        # See what's supported
```

---

## The Architecture Is Deliberately Boring (That's the Point)

Most "agent platforms" want to own your runtime. AgentSea doesn't.

The entire contract lives in a **static manifest** at the repo root � `manifest.json`. It declares:

- **Agents** � what to install, how to launch, which env vars to inject
- **Clouds** � how to provision, auth requirements, default instance sizes
- **Matrix** � which agent � cloud combinations are implemented

The CLI reads that manifest, talks directly to **your** cloud APIs (DigitalOcean REST, Hetzner, AWS Lightsail, GCP, Daytona SDK, Sprite CLI), and tracks local history under `~/.config/agentsea/`.

No Agentsea HTTP API. No multi-tenant control plane sitting between you and your VMs. Just a manifest, shell scripts, and cloud SDKs.

This is **Agentsea-style architecture** � the same philosophy as the original Agentsea project � but purpose-built for [The Grid](https://thegrid.ai) and fully CLI-first.

---

## Pick Your Agent. Pick Your Cloud. Go.

### Agents (11 and counting)

| Agent | What it is |
|-------|-----------|
| **Claude Code** | Anthropic's agentic coding CLI |
| **OpenClaw** | Personal AI assistant with multi-channel gateway + TUI |
| **Codex CLI** | OpenAI's open-source coding agent |
| **OpenCode** | Terminal-native coding agent (Go + Bubble Tea) |
| **Kilo Code** | Multi-provider agentic engineering platform |
| **Hermes** | Persistent agent with memory, tools, and messaging |
| **Junie** | JetBrains' coding agent with native Grid BYOK |
| **Pi** | Minimal multi-provider terminal harness |
| **Cursor CLI** | Cursor's terminal agent (plan, agent, ask modes) |
| **T3 Code** | Web GUI wrapper for Claude/Codex from Ping.gg |

New agents get added to the manifest. The CLI picks them up automatically.

### Clouds (7 options)

| Cloud | Starting price | Notes |
|-------|---------------|-------|
| **Local** | Free | Install and run on your machine � great for dev |
| **Hetzner** | ~�3/mo | European servers, solid defaults |
| **AWS Lightsail** | $3.50/mo | Familiar AWS billing |
| **DigitalOcean** | $4/mo | Featured default for most agents |
| **GCP Compute** | ~$7/mo | $300 free trial for new accounts |
| **Daytona** | Usage-based | Managed dev sandboxes with SDK access |
| **Sprite** | Free tier | One-command managed servers |

Every combination that works is marked `"implemented"` in the matrix. Run `agentsea matrix` to see the full grid � pun absolutely intended.

---

## Under the Hood: Four Steps, Zero Magic

When you run `agentsea claude digitalocean`, here's what happens:

**1. Provision**  
The CLI authenticates to your cloud (via `DIGITALOCEAN_ACCESS_TOKEN`, `HCLOUD_TOKEN`, etc.) and creates a VM with cloud-init userdata.

**2. Bootstrap**  
Cloud-init pulls a bootstrap script from the CDN (`/sh/<cloud>/<agent>.sh`) that installs the agent, its runtime (Node, Bun, Python, Rust binary � whatever the agent needs), and any proxy daemons.

**3. Wire The Grid**  
The VM gets `THEGRID_API_KEY` and OpenAI-compatible base URLs pointing at `api.thegrid.ai`. Billing stays on-platform. You bring one key; every agent speaks the same inference language.

**4. Run over SSH**  
The CLI opens an interactive SSH session. You're in the agent's TTY. Full terminal support. Drive it like you would locally � except it's on an isolated VM in NYC3.

For agents that need extra plumbing (Hermes needs a LiteLLM proxy, Cursor needs a ConnectRPC-to-REST translation layer, Junie needs redirect handling), AgentSea handles that during bootstrap. You don't configure it. You just agentsea.

---

## Why AgentSea?

### Agent-agnostic

The agent wars are real. Teams split across Claude, Codex, and OpenClaw. AgentSea doesn't pick sides. Start with whatever agent you use today; switch tomorrow without rewriting your infra.

### Bring your own cloud

Your provider account. Your keys. Your bill. We orchestrate; you own the data plane. No surprise egress fees to a hosted agent platform. No "upgrade to Pro for dedicated compute."

### Fully sandboxed

Each agentsea is an isolated VM and credential boundary. No cross-talk between sessions. Spin up five agents on five droplets for five parallel tasks. Tear them down when you're done.

### The Grid inference

One API key. OpenAI-compatible endpoints. Model catalogue, budgets, and usage tracking on-platform. Route Claude through Anthropic-compatible URLs, Codex through `/v1`, OpenClaw through the messages API � all from the same `THEGRID_API_KEY`.

---

## It's a Real CLI, Not a Demo

AgentSea isn't a proof of concept with a `--help` flag and nothing else. It's built for daily use:

```bash
agentsea claude hetzner --headless --output json   # CI/CD friendly
agentsea codex gcp --prompt "Add tests for auth"   # Non-interactive runs
agentsea claude sprite --fast                       # Parallel provisioning optimizations
agentsea fix <agentsea-id>                             # Recover a broken VM in-place
agentsea resume                                     # Continue a failed provision
agentsea tree                                       # Parent/child agentsea relationships
agentsea export <name>                              # Export a Claude agentsea to GitHub
agentsea cleanup digitalocean --dry-run             # Prune stale droplets
```

History lives locally. Rerun with `agentsea last`. Filter with `agentsea ls codex`. Delete with `agentsea rm`. Status with `agentsea ps`.

This is terminal-native infrastructure for terminal-native agents.

---

## Who Is This For?

**Solo developers** who want a dedicated agent VM without maintaining Docker Compose files and nginx configs.

**Platform teams** who need reproducible agent environments across cloud providers for internal tooling.

**The Grid users** who already have API keys and want the fastest path from key ? running agent.

**Agent builders** who want a reference deployment matrix � the manifest is public, the userdata scripts are public, fork it and add your agent.

---

## What It's Not

Let's be honest � it's **pre-alpha**. Things break. Edge cases exist. We're wiring up first-party image slugs and polishing the long tail of agent-specific quirks.

AgentSea is also **not** a hosted agent service. We don't run your VMs. We don't store your code. We give you the CLI and the manifest; you bring the cloud.

And it's **not** locked to one model provider. The Grid routes inference; you pick the model with `--model openai/gpt-5.3-codex` or your preferences file.

---

## Get Started in 60 Seconds

```bash
# 1. Install
curl -fsSL https://spawn.thegrid.ai/cli/install.sh | bash

# 2. Set your keys
export THEGRID_API_KEY=sk-or-v1-...
export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...

# 3. Agentsea
agentsea openclaw digitalocean
```

No global install? One-liner without the CLI:

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/sh/digitalocean/openclaw.sh)
```

Interactive picker if you can't decide:

```bash
agentsea
```

---

## The Bottom Line

The agent era needs infrastructure that matches how developers actually work: **CLI-first, cloud-native, provider-agnostic, and fast.**

AgentSea is that infrastructure.

One manifest. One CLI. Your cloud. Any agent. The Grid for inference.

Stop writing bootstrap scripts. Start spawning.

---

**AgentSea** is open source (Apache-2.0) from [Spectral Finance](https://github.com/Spectral-Finance/agentsea).  
Get your API key at [thegrid.ai](https://thegrid.ai).  
Read the CLI guide at [spawn.thegrid.ai/cli](https://spawn.thegrid.ai/cli).

---

*Tags: #AI #DevTools #CLI #CloudComputing #TheGrid #Agents #Infrastructure #OpenSource*
