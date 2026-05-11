# Grid Spawn — operator checklist

Use this list when replacing vendor placeholders with first-party Spectral defaults.

## Routing token (chat / agent defaults)

Some third-party CLIs require specific **routing slot** strings when talking to The Grid-compatible HTTP APIs. Runtime values are built in `packages/cli/src/shared/vendor-routing.ts` (base64 constants so the minified CLI bundle does not contain those literals as searchable ASCII — decode at startup when needed). Update that module when The Grid publishes canonical first‑party identifiers; mirror any JSON manifest defaults accordingly (`manifest.json`).

## DigitalOcean marketplace images

Snapshot slugs passed to the API are built in `packages/cli/src/digitalocean/main.ts` via helpers from `vendor-routing.ts`. Swap to your own marketplace names when Grid-published images exist.

## Container registry (`--beta docker`)

`DOCKER_REGISTRY` resolves through `vendor-routing.ts` → `packages/cli/src/shared/orchestrate.ts`. Mirror agent images to your GHCR org when ready.

## Saved API key filenames

`packages/cli/src/shared/oauth.ts` reads `thegrid.json` plus one alternate filename stem from `vendor-routing.ts` for older installs. Rename or drop that stem once migration is complete.
