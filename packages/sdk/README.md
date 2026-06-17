# `@agentsea/sdk`

Shared **Agentsea manifest contract** and small runtime helpers for the marketing site and `agentsea` CLI.

## What’s in the box

- **Types** — `Manifest`, `AgentDef`, `CloudDef`, `SkillDef`, … (same manifest shape used by **`agentsea`** and AgentSea tooling).
- **Pure helpers** — `parseJsonObj`, `Result` / `tryCatch` / `asyncTryCatch`, `isPlainObject`, `isString`, …
- **Node loader** (`@agentsea/sdk/node`) — `loadManifest()` reads, in order:

  1. `AGENTSEA_MANIFEST` (absolute path), if set and valid — legacy: `AGENTSEA_MANIFEST`
  2. `AGENTSEA_ROOT/manifest.json` when `AGENTSEA_ROOT` points at a checkout (same as CLI dotenv resolution) — legacy: `AGENTSEA_ROOT`
  3. The nearest `manifest.json` walking up from `process.cwd()` (max 10 segments)
  4. `https://raw.githubusercontent.com/the-gridai/agentsea/main/manifest.json`
  5. `~/.cache/agentsea/manifest.json` stale cache

Runtime is **Node + browser-safe**: import types and pure helpers from `@agentsea/sdk`; import `loadManifest` only from **`@agentsea/sdk/node`** (uses `node:fs`).

## What is *not* here

- **No `AgentseaApi` / mock** — there is no Agentsea control-plane HTTP API in this architecture (parity with Agentsea: static manifest + cloud APIs + local history).
- **Grid HTTP clients** — use a dedicated The Grid client when you want typed **Grid / Cortex** HTTP access (`whoami`/preflight only; provision stays in the CLI).
