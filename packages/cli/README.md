# `@agentsea/cli`

`agentsea` CLI for The Grid: **static `manifest.json`**, cloud SDKs/CLIs (DigitalOcean REST, Hetzner, Lightsail, GCP, Daytona, Sprite, local), userdata scripts under `sh/<cloud>/<agent>.sh`, and history under **`~/.config/agentsea/`**.

## Prerequisites

- **Bun runtime** (`>=1.2`) recommended; **`npm run build`** uses **`npx bun@1.3.9`** so you don’t need a global install.
- Repo-root **`manifest.json`** (walked upward from `cwd`) or network access to GitHub raw for **`Spectral-Finance/agentsea`**.

## Build & run from the monorepo

```bash
npm install
npm run build --workspace=@agentsea/cli
# or from root:
npm run build:cli

npm exec --workspace=@agentsea/cli -- agentsea --help
# or:
npm run agentsea -- --help
```

The bundled **`cli.js`** is gitignored until you build; keep it out of commits or regenerate in CI.

## Releases / supply chain

GitHub Releases hosts `digitalocean-latest` artifacts used by userdata shims under **`../../sh/`**. When publishing from a fork, add **immutable versioned** assets alongside `*-latest` and document their SHA-256; users can set **`AGENTSEA_BUNDLE_SHA256`** (legacy: `AGENTSEA_BUNDLE_SHA256`; see repo **`.env.example`**) so `openclaw.sh` verifies the download.

## Auth

Platform LLM/key usage is **`THEGRID_API_KEY`** (Grid dashboard). Persisted reuse (optional steps) writes **`~/.config/agentsea/thegrid.json`**. An alternate filename from early releases may still be read; see **`packages/cli/src/shared/oauth.ts`**.

When you run the CLI from a checkout, a **repo-root `.env`** next to **`manifest.json`** is loaded automatically (does not replace variables already set in your shell). To point at a checkout when your current directory is elsewhere, set **`AGENTSEA_ROOT`** to that repository path (legacy: `AGENTSEA_ROOT`). Set **`AGENTSEA_DEBUG=1`** or **`AGENTSEA_DEBUG_ENV=1`** to log which `.env` path was loaded (never prints secret values).

Individual clouds use existing env conventions from the inherited matrix (`DIGITALOCEAN_TOKEN`, `HCLOUD_TOKEN`, etc.) — see **`manifest.json` → clouds**.

Forks / self-built binaries may set **`AGENTSEA_POSTHOG_PROJECT_KEY`** to a different PostHog **public** ingest key (optional; defaults to the bundled project).

## Package layout

Source layout: **`src/index.ts`**, shared modules under **`src/shared/`**, cloud orchestrators under **`src/<cloud>/`**. See repo-root **`todo.md`** for marketplace slugs and routing tokens you may need to replace with first-party values.
