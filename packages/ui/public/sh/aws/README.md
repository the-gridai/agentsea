# AWS Lightsail

AWS Lightsail instances via AWS CLI. [AWS Lightsail](https://aws.amazon.com/lightsail/)

## Prerequisites

1. **Enable AWS Lightsail** — New AWS accounts must activate Lightsail before first use. Visit the [Lightsail console](https://lightsail.aws.amazon.com/ls/webapp/home) and follow the activation prompt. Without this step, all provisioning commands will fail.

2. **AWS CLI installed and configured** — Run `aws configure` with your Access Key ID and Secret Access Key.

> Uses `ubuntu` user instead of `root`.

## Agents

#### Claude Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/claude.sh)
```

#### OpenClaw

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/openclaw.sh)
```

#### Codex CLI

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/codex.sh)
```

#### OpenCode

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/opencode.sh)
```

#### Kilo Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/kilocode.sh)
```

#### Hermes Agent

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/hermes.sh)
```

#### Junie

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/junie.sh)
```

#### Cursor CLI

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/cursor.sh)
```

#### Pi

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/pi.sh)
```

#### T3 Code

```bash
bash <(curl -fsSL https://spawn.thegrid.ai/aws/t3code.sh)
```

## Non-Interactive Mode

```bash
LIGHTSAIL_SERVER_NAME=dev-mk1 \
THEGRID_API_KEY=sk-or-v1-xxxxx \
  bash <(curl -fsSL https://spawn.thegrid.ai/aws/claude.sh)
```
