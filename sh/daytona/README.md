# Daytona

Daytona managed sandboxes via the Daytona SDK. [Daytona](https://www.daytona.io/)

> Uses Daytona's sandbox lifecycle, filesystem, process, SSH access, and signed preview APIs. Requires `DAYTONA_API_KEY` from https://app.daytona.io/dashboard/keys.

## Agents

#### Claude Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/claude.sh)
```

#### OpenClaw

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/openclaw.sh)
```

#### Codex CLI

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/codex.sh)
```

#### OpenCode

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/opencode.sh)
```

#### Kilo Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/kilocode.sh)
```

#### Hermes Agent

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/hermes.sh)
```

#### Junie

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/junie.sh)
```

#### Cursor CLI

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/cursor.sh)
```

#### Pi

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/pi.sh)
```

#### T3 Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/daytona/t3code.sh)
```

## Non-Interactive Mode

```bash
DAYTONA_SANDBOX_NAME=dev-mk1 \
DAYTONA_API_KEY=your-api-key \
THEGRID_API_KEY=sk-or-v1-xxxxx \
  bash <(curl -fsSL https://spawn.thegrid.ai/daytona/claude.sh)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DAYTONA_API_KEY` | Daytona API key | _(prompted)_ |
| `DAYTONA_SANDBOX_NAME` | Sandbox name | _(prompted)_ |
| `DAYTONA_IMAGE` | Base sandbox image | `daytonaio/sandbox:latest` |
| `DAYTONA_SANDBOX_SIZE` | Spawn preset (`user-default`, `org-default`) | `user-default` |
| `DAYTONA_CPU` | vCPU override | `1` when partially overridden |
| `DAYTONA_MEMORY` | Memory override in GiB | `1` when partially overridden |
| `DAYTONA_DISK` | Disk override in GiB | `3` when partially overridden |
| `THEGRID_API_KEY` | The Grid platform API key | _(OAuth or prompted)_ |

If you leave all sandbox sizing variables unset, Spawn defers to Daytona's platform defaults: 1 vCPU, 1 GiB RAM, and 3 GiB disk. Set `DAYTONA_SANDBOX_SIZE=org-default` to request Daytona's documented organization per-sandbox limit: 4 vCPU, 8 GiB RAM, and 10 GiB disk.

Signed preview URLs are generated on demand for web dashboards. SSH access tokens are minted only when you connect and are never stored in Spawn history.
