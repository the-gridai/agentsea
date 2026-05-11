# `@grid-spawn/cli`

`grid-spawn` CLI for The Grid: **static `manifest.json`**, cloud SDKs/CLIs (DigitalOcean REST, Hetzner, Lightsail, GCP, Daytona, Sprite, local), userdata scripts under `sh/<cloud>/<agent>.sh`, and history under **`~/.config/grid-spawn/`**.

## Prerequisites

- **Bun runtime** (`>=1.2`) recommended; **`npm run build`** uses **`npx bun@1.3.9`** so you don’t need a global install.
- Repo-root **`manifest.json`** (walked upward from `cwd`) or network access to GitHub raw for **`Spectral-Finance/grid-spawn`**.

## Build & run from the monorepo

```bash
npm install
npm run build --workspace=@grid-spawn/cli
# or from root:
npm run build:cli

npm exec --workspace=@grid-spawn/cli -- grid-spawn --help
# or:
npm run grid-spawn -- --help
```

The bundled **`cli.js`** is gitignored until you build; keep it out of commits or regenerate in CI.

## Auth

Platform LLM/key usage is **`THEGRID_API_KEY`** (Grid dashboard). Persisted reuse (optional steps) writes **`~/.config/grid-spawn/thegrid.json`**. An alternate filename from early releases may still be read; see **`packages/cli/src/shared/oauth.ts`**.

Individual clouds use existing env conventions from the inherited matrix (`DIGITALOCEAN_TOKEN`, `HCLOUD_TOKEN`, etc.) — see **`manifest.json` → clouds**.

Forks / self-built binaries may set **`SPAWN_POSTHOG_PROJECT_KEY`** to a different PostHog **public** ingest key (optional; defaults to the bundled project).

## Package layout

Source layout: **`src/index.ts`**, shared modules under **`src/shared/`**, cloud orchestrators under **`src/<cloud>/`**. See repo-root **`todo.md`** for marketplace slugs and routing tokens you may need to replace with first-party values.
