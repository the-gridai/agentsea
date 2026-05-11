// shared/posthog-config.ts — single source of PostHog project key + endpoint URLs.
// The key is a public ingestion key (same class as client-side analytics); it does not
// grant read access to your PostHog data. Used by telemetry, feedback, feature flags.

/** PostHog project API key (ingest / decide). */
export const POSTHOG_PROJECT_API_KEY =
  process.env.SPAWN_POSTHOG_PROJECT_KEY?.trim() || "phc_7ToS2jDeWBlMu4n2JoNzoA1FnArdKwFMFoHVnAqQ6O1";

export const POSTHOG_BATCH_INGEST_URL = "https://us.i.posthog.com/batch/";

/** Single-event capture URL (survey / feedback payloads). */
export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

/** Feature flag evaluation (decide API). */
export const POSTHOG_DECIDE_URL = "https://us.i.posthog.com/decide/?v=3";
