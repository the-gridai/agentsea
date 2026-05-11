# Local Machine

Run agents directly on your local machine without any cloud provisioning.

> No server creation or destruction. Installs agents and configures THEGRID_API_KEY locally. Useful for local development and testing.

## Quick Start

If you have [grid-spawn](https://github.com/Spectral-Finance/grid-spawn) installed:

```bash
grid-spawn claude local
grid-spawn openclaw local
grid-spawn codex local
grid-spawn opencode local
grid-spawn kilocode local
grid-spawn hermes local
grid-spawn junie local
grid-spawn cursor local
grid-spawn pi local
grid-spawn t3code local
```

Or run directly without the CLI:

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/local/claude.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/openclaw.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/codex.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/opencode.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/kilocode.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/hermes.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/junie.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/cursor.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/pi.sh)
bash <(curl -fsSL https://spawn.thegrid.ai/local/t3code.sh)
```

## Non-Interactive Mode

```bash
THEGRID_API_KEY=sk-or-v1-xxxxx \
  bash <(curl -fsSL https://spawn.thegrid.ai/local/claude.sh)
```

## What It Does

Local scripts will:
- Install the agent if not already present
- Obtain a The Grid API key (via OAuth or environment variable)
- Append environment variables to `~/.zshrc` for the agent to use
- Launch the agent

No cloud servers are created or destroyed.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THEGRID_API_KEY` | The Grid platform API key (prompted via OAuth if not set) |
| `SPAWN_PROMPT` | If set, runs the agent non-interactively with this prompt |
