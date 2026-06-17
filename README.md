# Agent Sea

> **CLI-first agent VM launcher**, static-manifest Agentsea-style architecture for **The Grid**: static repo-root **`manifest.json`**, **`agentsea`** provisions against **your** cloud accounts, **`sh/<cloud>/<agent>.sh`** userdata, local history under **`~/.config/agentsea/`** — **no Agentsea web UI, no Agentsea HTTP API.**

Authenticate with **`THEGRID_API_KEY`** (Grid platform) plus per-cloud tokens (`DIGITALOCEAN_TOKEN`, `HCLOUD_TOKEN`, …). The repo ships a static manifest + per-cloud userdata scripts; the CDN origin is resolved per environment (dev `https://agentsea.dev.thegrid.ai`, staging `https://agentsea.staging.thegrid.ai`, prod `https://agentsea.thegrid.ai`) — pinned by `install.sh` and overridable via **`AGENTSEA_CDN`**. See **`todo.md`** for public roadmap items.

## Status

**Pre-alpha.**

| Path | Role |
|------|------|
| **`manifest.json`**, **`sh/`**, **`assets/`** | Public matrix contract + CDN-installable userdata + icons |
| **`packages/cli`** | `agentsea` — Bun bundle (`npm run build:cli` → `packages/cli/cli.js`) |
| **`packages/sdk`** | `@agentsea/sdk` — manifest types + `loadManifest()` (`@agentsea/sdk/node`) |
| **`packages/ui`** | Next.js 15 brochure: **`/`** (manifest-backed landing), **`/cli`** (CLI guide only) |

Optional: **The Grid SDK** for **`whoami` / Cortex preflight** — not used for provisioning.

## Layout

```
agentsea/
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
npm run agentsea -- --help

npm run typecheck
npm run lint
npm run build
```

CDN / one-liner base URL defaults with **`AGENTSEA_CDN`**; the marketing env mirror is **`NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN`**.

For local provisioning, copy **`.env.example`** → **`.env`** at the repo root (ignored by git). **`agentsea`** loads it automatically when your shell is under this tree, or set **`AGENTSEA_ROOT`** to point at it.

Older routes (`/spawns`, `/login`, `/settings`, …) **redirect** to **`/`** or **`/cli`**.

## License

Apache-2.0. See `LICENSE`.
