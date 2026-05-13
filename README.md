# Grid Spawn

> **CLI-first agent VM launcher**, static-manifest Spawn-style architecture for **The Grid**: static repo-root **`manifest.json`**, **`grid-spawn`** provisions against **your** cloud accounts, **`sh/<cloud>/<agent>.sh`** userdata, local history under **`~/.config/grid-spawn/`** — **no Spawn web UI, no Spawn HTTP API.**

Authenticate with **`THEGRID_API_KEY`** (Grid platform) plus per-cloud tokens (`DIGITALOCEAN_TOKEN`, `HCLOUD_TOKEN`, …). The repo ships a static manifest + per-cloud userdata scripts; CDN defaults to **`https://spawn.thegrid.ai`** via **`GRID_SPAWN_CDN`**. See **`todo.md`** for first-party image slugs and other items to wire up.

## Status

**Pre-alpha.**

| Path | Role |
|------|------|
| **`manifest.json`**, **`sh/`**, **`assets/`** | Public matrix contract + CDN-installable userdata + icons |
| **`packages/cli`** | `grid-spawn` — Bun bundle (`npm run build:cli` → `packages/cli/cli.js`) |
| **`packages/sdk`** | `@grid-spawn/sdk` — manifest types + `loadManifest()` (`@grid-spawn/sdk/node`) |
| **`packages/ui`** | Next.js 15 brochure: **`/`** (manifest-backed landing), **`/cli`** (CLI guide only) |

Optional: **[Spectral `grid-ts`](https://github.com/Spectral-Finance/grid-ts)** for **`whoami` / Cortex preflight** — not used for provisioning.

## Layout

```
grid-spawn/
├── manifest.json
├── sh/
├── assets/
├── packages/
│   ├── sdk/
│   ├── cli/
│   └── ui/
├── package.json
└── tsconfig.base.json
```

## Quick start

```bash
npm install

# Marketing site → http://localhost:3011
npm run dev

# Bun-bundled CLI (needs `npx` network on first Bun download, or use global `bun`)
npm run build:cli
npm run grid-spawn -- --help

npm run typecheck
npm run lint
npm run build
```

CDN / one-liner base URL defaults with **`GRID_SPAWN_CDN`**; the marketing env mirror is **`NEXT_PUBLIC_GRID_SPAWN_PUBLIC_ORIGIN`**.

For local provisioning, copy **`.env.example`** → **`.env`** at the repo root (ignored by git). **`grid-spawn`** loads it automatically when your shell is under this tree, or set **`GRID_SPAWN_ROOT`** to point at it.

Older routes (`/spawns`, `/login`, `/settings`, …) **redirect** to **`/`** or **`/cli`**.

## License

Apache-2.0 (intent — not yet committed).
