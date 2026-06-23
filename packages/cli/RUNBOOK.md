# Operator runbook (AgentSea CLI)

## Provisioning stuck after droplet create

1. Check history: `agentsea list --json` — look for `provision_phase` and `provision_status`.
2. Recover crash-sidecar if history is empty but a VM exists: `agentsea resume --recover`, then `agentsea resume`.
3. If SSH works: `agentsea fix [<agentsea-id>]`.

## Headless / scripted runs

- Set `AGENTSEA_HEADLESS=1`. The CLI uses a lock file under `~/.config/agentsea/runs/` so two concurrent headless runs do not create duplicate droplets.
- Prefer **version-pinned** bundles: set `AGENTSEA_BUNDLE_SHA256` when using `sh/digitalocean/openclaw.sh`.

## Billing / orphaned VMs (DigitalOcean)

- List tagged droplets: use `agentsea cleanup digitalocean --dry-run` (destroys droplets tagged `agentsea` older than the default TTL unless overridden).
- Confirm interactive or pass `--yes` in CI/automation.

## The Grid API key

- Keys are validated against `GET https://api.thegrid.ai/v1/models` when possible.
- `agentsea auth login` runs Grid OAuth device flow and creates/reuses a consumption key.
- `agentsea auth status` shows session/key state; `agentsea auth logout` clears local OAuth + saved key state.
- Auto-OAuth during provisioning is enabled by default; set `AGENTSEA_GRID_OAUTH=0` to disable it.
- Headless guidance: if no key is available, set `THEGRID_API_KEY` or pre-login with `agentsea auth login`.
- If OAuth token lacks `keys:manage`, AgentSea shows guidance and falls back to manual key entry.
