// shared/cdn.ts — Re-exports the canonical CDN origin resolver from @agentsea/sdk.
//
// The resolution logic (AGENTSEA_CDN env var → install-time pin in
// ~/.config/agentsea/cdn-origin → built-in default) lives in the SDK so the CLI
// and SDK can never drift onto different hosts. See packages/sdk/src/node/cdn.ts.

export { AGENTSEA_DEFAULT_CDN, CDN_ORIGIN_FILE, getCdnOrigin } from "@agentsea/sdk/node";
