# AgentSea Public Roadmap

This is a short public-facing checklist for pre-alpha work that still needs
validation before AgentSea is considered stable.

## Provider Images

- Publish first-party cloud images for providers that currently rely on fallback
  bootstrap flows.
- Keep `manifest.json` aligned with supported image slugs and provider status.

## Agent Runtime Defaults

- Review model and routing defaults for each agent as The Grid publishes stable
  production identifiers.
- Keep provider-specific setup in `packages/cli/src/shared/vendor-routing.ts`
  covered by CLI tests when defaults change.

## Container Launches

- Mirror supported agent images to the public registry used by AgentSea.
- Document the `--beta docker` flow once image publishing is stable.

## Compatibility Cleanup

- Remove legacy compatibility aliases after existing pre-alpha installs have a
  documented migration path.
- Keep public install scripts and release assets aligned with
  `the-gridai/agentsea`.
