/**
 * First-touch attribution capture for AgentSea (agentsea.thegrid.ai).
 *
 * On the user's first visit we snapshot the marketing context (UTM bag,
 * referral code, HTTP referrer, landing URL, ad-click ids) into `localStorage`
 * and seed Mixpanel's first-touch super-properties from it. This is what lets
 * us attribute an agentsea visitor to their real source and follow them across
 * properties (website → agentsea → app), all in the same Mixpanel project.
 *
 * First-touch semantics: once a visit with a real marketing signal (any UTM,
 * gclid/fbclid, referral_code/ref) has been recorded, we never overwrite it.
 * Visits that only carry `landing_url`/`http_referrer` are "weak" and can still
 * be upgraded by a later UTM-bearing visit.
 *
 * SSR-safe: every entry point no-ops when `window` is unavailable.
 */

export const STORAGE_KEY = "agentsea-signup-attribution";

const URL_INPUT_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "referral_code",
] as const;

const FE_DERIVED_KEYS = ["http_referrer", "landing_url"] as const;

export const ATTRIBUTION_KEYS = [...URL_INPUT_KEYS, ...FE_DERIVED_KEYS] as const;

type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

export type SignupAttribution = Partial<Record<AttributionKey, string>>;

const isBrowser = (): boolean => typeof window !== "undefined" && typeof localStorage !== "undefined";

const sanitize = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Read the current first-touch attribution payload, or `{}` if none has been
 * captured yet (or storage is unavailable / corrupt).
 */
export const getAttribution = (): SignupAttribution => {
  if (!isBrowser()) return {};

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as SignupAttribution;
  } catch {
    return {};
  }
};

/**
 * OAuth provider hostnames that show up as `document.referrer` but are NOT real
 * traffic sources. Only the Google OAuth-specific subdomain is listed (distinct
 * from organic `google.com`); `github.com` is deliberately excluded because its
 * OAuth flow and a real GitHub referral share the same host.
 */
export const OAUTH_PROVIDER_DOMAINS = ["accounts.google.com"] as const;

export const isOAuthProviderDomain = (host: string): boolean =>
  OAUTH_PROVIDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));

const MP_INITIAL_REFERRER = "$initial_referrer";
const MP_INITIAL_REFERRING_DOMAIN = "$initial_referring_domain";
const MP_DIRECT = "$direct";

/**
 * Build the Mixpanel super-properties seed from the stored first-touch payload
 * so we can `register_once(...)` the real source before Mixpanel would
 * auto-capture an OAuth provider domain. `$initial_referrer` /
 * `$initial_referring_domain` are always emitted (mirroring Mixpanel's
 * `referrer || "$direct"` semantics); UTM values are copied through when
 * present.
 */
export const getInitialSuperProps = (): Record<string, string> => {
  const stored = getAttribution();
  const props: Record<string, string> = {};

  const referrer = sanitize(stored.http_referrer);
  let host: string | undefined;
  if (referrer !== undefined) {
    try {
      host = new URL(referrer).hostname;
    } catch {
      host = undefined;
    }
  }

  if (referrer !== undefined && host && !isOAuthProviderDomain(host)) {
    props[MP_INITIAL_REFERRER] = referrer;
    props[MP_INITIAL_REFERRING_DOMAIN] = host;
  } else {
    props[MP_INITIAL_REFERRER] = MP_DIRECT;
    props[MP_INITIAL_REFERRING_DOMAIN] = MP_DIRECT;
  }

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const) {
    const value = sanitize(stored[key]);
    if (value !== undefined) props[key] = value;
  }

  return props;
};

const hasUrlInputKey = (payload: SignupAttribution): boolean =>
  URL_INPUT_KEYS.some((key) => typeof payload[key] === "string");

/**
 * Capture first-touch attribution from `window.location` + `document.referrer`.
 * No-op in SSR and on later visits once a real marketing signal is stored. A
 * "weak" stored payload (only landing_url/http_referrer) is upgraded by the
 * first UTM-bearing visit.
 */
export const captureFirstTouch = (): SignupAttribution => {
  if (!isBrowser()) return {};

  const existing = getAttribution();
  if (hasUrlInputKey(existing)) return existing;

  const params = new URLSearchParams(window.location.search);
  const payload: SignupAttribution = {};

  for (const key of URL_INPUT_KEYS) {
    const value = sanitize(params.get(key));
    if (value !== undefined) payload[key] = value;
  }

  // `?ref=` is a common short alias for `referral_code`.
  if (payload.referral_code === undefined) {
    const ref = sanitize(params.get("ref"));
    if (ref !== undefined) payload.referral_code = ref;
  }

  const incomingHasUrlInputKey = hasUrlInputKey(payload);

  if (!incomingHasUrlInputKey && Object.keys(existing).length > 0) {
    return existing;
  }

  const referrer = sanitize(document.referrer);
  if (referrer !== undefined) payload.http_referrer = referrer;

  const landing = sanitize(window.location.href);
  if (landing !== undefined) payload.landing_url = landing;

  if (Object.keys(payload).length === 0) return {};

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may throw under quota / private-browsing — attribution is
    // best-effort.
  }

  return payload;
};

/**
 * Clear the stored first-touch payload (e.g. after a successful conversion) so
 * the next user on the same browser starts fresh.
 */
export const clearAttribution = (): void => {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};
