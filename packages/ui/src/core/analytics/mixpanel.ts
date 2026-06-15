import mixpanel from "mixpanel-browser";

import { AGENTSEA_PUBLIC_ORIGIN } from "@/app/home-public-constants";
import { captureFirstTouch, getInitialSuperProps } from "@/core/analytics/attribution";

const isServer = typeof window === "undefined";

type Environment = "prod" | "staging" | "dev";

/**
 * Mixpanel project tokens, hardcoded per environment — exactly like grid-ui
 * (src/core/constants/env.ts) and the marketing site. The token is a PUBLIC
 * project id (it ships in the browser bundle either way), so there is nothing
 * to hide and no env var needed. These are the SAME tokens the app and website
 * use, so agentsea reports into the SAME Mixpanel projects — which is what lets
 * us track users converting from agentsea usage into grid app usage.
 */
const MIXPANEL_TOKEN_BY_ENV: Record<Environment, string> = {
  dev: "4c89893ce153fba8bd0926b263114dc9",
  staging: "cb0b2f547f314c5fa43e9db88ec6e6d5",
  prod: "908b8f6befbeeecf19c0fd4a552276dd",
};

/**
 * Derive the environment from the public origin agentsea is served from
 * (`agentsea.thegrid.ai` / `agentsea.staging.thegrid.ai` /
 * `agentsea.dev.thegrid.ai`). Reuses an existing per-deploy signal rather than
 * introducing a new env var, and defaults to prod.
 */
const environment: Environment = AGENTSEA_PUBLIC_ORIGIN.includes(".staging.")
  ? "staging"
  : AGENTSEA_PUBLIC_ORIGIN.includes(".dev.")
    ? "dev"
    : "prod";

const MIXPANEL_TOKEN = MIXPANEL_TOKEN_BY_ENV[environment];

const isDev = environment !== "prod";

/**
 * Analytics is on by default and can be force-disabled with
 * `NEXT_PUBLIC_ENABLE_ANALYTICS=false` (e.g. for preview/test deploys).
 */
export const isAnalyticsEnabled = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS !== "false";

if (!isServer && isAnalyticsEnabled) {
  mixpanel.init(MIXPANEL_TOKEN, {
    // Built-in auto page view ($mp_web_page_view). We ALSO emit a custom
    // "Page Viewed" event (see page-view-tracker.tsx) to match the marketing
    // site, so cross-property funnels/reports built on that name include
    // agentsea.
    track_pageview: "url-with-path-and-query-string",
    persistence: "localStorage",
    // Disable automatic referrer capture; we seed the real first-touch source
    // from our own attribution store below (mirrors grid-ui).
    save_referrer: false,
    record_sessions_percent: 50,
    debug: isDev,
  });

  // Seed first-touch referrer/UTM super-properties BEFORE Mixpanel's deferred
  // auto-pageview fires. Idempotent + register_once → a returning user's
  // original attribution is never overwritten.
  captureFirstTouch();
  const superProps = getInitialSuperProps();
  if (Object.keys(superProps).length > 0) {
    mixpanel.register_once(superProps);
  }
}

export const identify = (userId: string, props?: Record<string, unknown>) => {
  if (isServer || !isAnalyticsEnabled) return;
  mixpanel.identify(userId);
  if (props) mixpanel.people.set(props);
};

export const track = (event: string, props?: Record<string, unknown>) => {
  if (isServer || !isAnalyticsEnabled) return;
  mixpanel.track(event, props);
};

export const reset = () => {
  if (isServer || !isAnalyticsEnabled) return;
  mixpanel.reset();
};

export const setUserProperties = (props: Record<string, unknown>) => {
  if (isServer || !isAnalyticsEnabled) return;
  mixpanel.people.set(props);
};
