# CLI tests (`bun:test`)

AgentSea mirrors [openrouter/agentsea](https://github.com/OpenRouterTeam/agentsea): **Bun's built-in test runner** (`bun:test`). Do not use Vitest for this package.

```bash
cd packages/cli
npm run test

# Or from repo root
npm run test:cli
```

## Preload sandbox

[`preload.ts`](./preload.ts) runs before every file via [`../bunfig.toml`](../bunfig.toml). It redirects `HOME`, `XDG_*`, `AGENTSEA_HOME`, sets `AGENTSEA_ROOT` to an empty sandbox dir, assigns `THEGRID_API_KEY` when unset, and **`process.chdir`** into that sandbox so `resolveBundledShRepoRoot` cannot discover the real checkout via cwd walk-up.

[`fs-sandbox.test.ts`](./fs-sandbox.test.ts) asserts the sandbox prefix.

## Helpers

[`test-helpers.ts`](./test-helpers.ts) — `createMockManifest`, `mockClackPrompts`, `mockBunAgentsea`, `setupTestEnvironment` / `teardownTestEnvironment` (manifest disk cache lives under `agentsea/` inside `XDG_CACHE_HOME`).

## P1 coverage (implemented)

| Area | Files |
|------|--------|
| Sandbox | `preload.ts`, `fs-sandbox.test.ts` |
| Manifest | `manifest*.test.ts` |
| Security | `security*.test.ts`, `prompt-file-security.test.ts` |
| Parsing / flags | `parse.test.ts`, `picker-cov.test.ts`, `fuzzy-key-matching.test.ts`, `unknown-flags.test.ts`, `result-helpers.test.ts` |
| History / paths / shell | `history*.test.ts`, `paths.test.ts`, `shell.test.ts` |
| Commands | `cmdrun-happy-path.test.ts`, `cmdrun-duplicate-detection.test.ts`, `cmd-interactive.test.ts`, `cmd-listing-output.test.ts`, `cmdlast.test.ts`, `commands-error-paths.test.ts`, `commands-name-suggestions.test.ts`, `commands-resolve-run.test.ts`, `commands-swap-resolve.test.ts` |
| Grid-only | `load-env.test.ts`, `cli-invocation.test.ts`, `grid-models.test.ts`, `vendor-routing.test.ts`, `verbosity.test.ts` |
| Infra | `with-retry-result.test.ts` |

## Phase 2 — follow-ups (not implemented yet)

Port / add tests comparable to openrouter for:

- Cloud modules (`aws`, `gcp`, `digitalocean`, `hetzner`, `sprite`, `daytona`) `*-cov.test.ts`
- OAuth (`oauth-*.test.ts`)
- SSH (`ssh*.test.ts`, `ssh-runner.test.ts`)
- Per-command coverage (`cmd-*-cov.test.ts`)
- Specialized: `agent-setup-cov`, `agent-tarball`, `recursive-agentsea`, `agentsea-config`, `agentsea-md`, `agentsea-skill`, `star-prompt`, `update-check`, `auto-update`, `feature-flags`, `lifecycle-telemetry`, `billing-guidance`, `cursor-proxy`, etc.
- **posthog-config** (agentsea-only)
- UI / Next.js tests (skipped by initial scope)
