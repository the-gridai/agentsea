# Telemetry and privacy

The `agentsea` CLI sends **optional analytics** to PostHog when telemetry is enabled (default on).

## What is collected

- Funnel milestones (e.g. cloud authenticated, VM ready, install completed).
- Low-volume product events and **scrubbed** error summaries.
- Anonymous install id (`~/.config/agentsea/.telemetry-id`).

**Not** collected: command arguments, file paths, your prompts, or raw API keys (patterns in error text are redacted — see `packages/cli/src/shared/telemetry.ts`).

## Opt out

```bash
export AGENTSEA_TELEMETRY=0
```

## Retention and DPA

Point your privacy officer at this file and your PostHog project settings for retention, region, and data processing agreements.
