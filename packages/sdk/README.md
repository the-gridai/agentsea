# `@grid-spawn/sdk`

Shared **Spawn manifest contract** and small runtime helpers for the marketing site and `grid-spawn` CLI.

## What’s in the box

- **Types** — `Manifest`, `AgentDef`, `CloudDef`, `SkillDef`, … (same manifest shape used by **`grid-spawn`** and Grid Spawn tooling).
- **Pure helpers** — `parseJsonObj`, `Result` / `tryCatch` / `asyncTryCatch`, `isPlainObject`, `isString`, …
- **Node loader** (`@grid-spawn/sdk/node`) — `loadManifest()` reads, in order:

  1. `GRID_SPAWN_MANIFEST` (absolute path), **or** the nearest `manifest.json` walking up from `process.cwd()`
  2. `https://raw.githubusercontent.com/Spectral-Finance/grid-spawn/main/manifest.json`
  3. `~/.cache/grid-spawn/manifest.json` stale cache

Runtime is **Node + browser-safe**: import types and pure helpers from `@grid-spawn/sdk`; import `loadManifest` only from **`@grid-spawn/sdk/node`** (uses `node:fs`).

## What is *not* here

- **No `SpawnApi` / mock** — there is no Spawn control-plane HTTP API in this architecture (parity with Spawn: static manifest + cloud APIs + local history).
- **`grid-ts`** — use [Spectral `grid-ts`](https://github.com/Spectral-Finance/grid-ts) when you want a typed **Grid / Cortex** HTTP client (`whoami`/preflight only; provision stays in the CLI).
