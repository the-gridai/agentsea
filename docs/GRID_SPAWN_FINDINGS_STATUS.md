# Grid Spawn Findings — status (#1–#42)

Tracked against the master implementation plan. Update the spreadsheet `Fixed?` column when closing rows in production.

| Issue | Status | Notes |
|-------|--------|-------|
| #1 OpenClaw maxTokens | Fixed | `contextWindow` / `maxTokens` in provider model entry |
| #2 npm audit | Fixed | Documented; CI optional |
| #3–#5 | Fixed | Prior branch; verify in Tier 4 DO E2E |
| #6 CDN host | Fixed | `NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN` in UI |
| #7 CLI 404 | Fixed | CDN publish path in install.sh + sdk/cdn.ts |
| #8 Anchor scroll | Fixed | `scroll-margin-top` on bands |
| #9 PATH hint | Fixed | `export PATH=…` instead of `exec $SHELL` |
| #10 Internal URLs | Fixed | Scrubbed from public comments |
| #11 Server name | Fixed | Default `agentsea-{agent}` (cloud hostnames add uuid suffix) |
| #12 Script fallback | Fixed | Local cloud runs in-process from `cli.js`; checkout `AGENTSEA_CLI_DIR` for other clouds |
| #13 Error colors | Fixed | `logError` resets stderr SGR after Clack; all `p.log.error` routed through it |
| #14 Hermes direct API | Fixed | `api.thegrid.ai/v1` + redirect follow |
| #15 Codex sudo | N/A (codex disabled) | LiteLLM proxy removed; codex disabled until Grid `/v1/responses` |
| #16 Agent sort | Fixed | Recommended default (OpenClaw, Hermes, Kilo first); sort dropdown: Recommended, GitHub stars, Name; disabled agents listed last |
| #17–#18 SEO | Fixed | Canonical `/{agent}/{cloud}` launch pages; `/cli?agent=&cloud=` → 308 redirect; sitemap from manifest matrix; per-route title/description/OG |
| #19 Install chain | Fixed | `install.sh \| bash -s -- agent cloud` installs then execs `agentsea agent cloud` |
| #19b Simplify UX | Fixed | Deploy pages: single one-liner; install-only / deploy-only in collapsibles |
| #20 CDN env | Fixed | Documented in README / UI deploy |
| #21 API key dup msg | Fixed | Single consumption-key hint |
| #22 Instruments | Fixed | `grid-instruments.ts` + picker ★ |
| #23 Mixpanel | External | Product / marketing |
| #24 Progress | Fixed | Verbose `logStep` sub-steps |
| #25 Hermes dashboard | Fixed | Health poll + list → Open Dashboard |
| #26 Droplet name | Fixed | `agentsea-{agent}` label + uuid for DO hostname |
| #27 OpenCode hang | Fixed | `opencode run` + 600s timeout |
| #28 Resume | Fixed | `agent_configured` checkpoint + preLaunch |
| #29 Prerequisites | Fixed | bash, curl, ssh, jq on homepage |
| #30 Post-install | Fixed | After-install section + Grid doc links |
| #31 Context fields | Fixed | Hermes `context_length`, OpenClaw windows |
| #32 API key loop | Fixed | Empty key does not count as failed attempt |
| #33–#37 Headless | Fixed | `headless-prompts.ts` |
| #38 Responses API | Disabled (codex + t3code) | No Responses API on Grid; codex/t3code disabled until `/v1/responses` |
| #39 Kilo models | Fixed | `thegrid` in `kilo.jsonc` |
| #40 Kilo exit 0 | Fixed | `wrapHeadlessPromptCmd` orchestration |
| #41 Cursor bootstrap | Fixed | Sudo-free Caddy in `~/.local/bin` |
| #42 Cursor tools | Disabled | `disabled: true` in manifest; hidden from UI; CLI rejects `agentsea cursor` |
