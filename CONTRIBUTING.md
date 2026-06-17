# Contributing to AgentSea

Thanks for your interest in AgentSea. This project is pre-alpha, so small,
well-scoped changes with clear test coverage are easiest to review.

## Development Setup

Use Node.js 20.19 or newer and npm 10 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

The CLI bundle uses Bun during build and test. CI installs the pinned Bun version
declared in the GitHub workflows.

## Local Configuration

Copy `.env.example` to `.env` for local credentials. Do not commit `.env`, cloud
tokens, private keys, generated bundles, logs, or local e2e artifacts.

## Pull Requests

Before opening a pull request:

1. Keep changes focused on one behavior or documentation update.
2. Update tests or runbooks when behavior changes.
3. Run the relevant workspace checks locally.
4. Confirm `git status --short --ignored` does not show any accidentally staged
   secrets or generated files.

## Release Artifacts

Do not commit generated CLI/provider bundles. GitHub Actions build and publish
release assets from source.
