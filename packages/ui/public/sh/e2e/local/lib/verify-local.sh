#!/usr/bin/env bash
# e2e/local/lib/verify-local.sh — post-provision filesystem checks on the host (no cloud_exec)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-local.sh
source "$SCRIPT_DIR/common-local.sh"

verify_agentsearc() {
  local agent="$1"
  if [[ ! -f "$HOME/.agentsearc" ]]; then
    log_err "$agent: ~/.agentsearc missing"
    return 1
  fi
  if ! grep -q 'THEGRID_API_KEY=' "$HOME/.agentsearc"; then
    log_err "$agent: THEGRID_API_KEY missing from ~/.agentsearc"
    return 1
  fi
  log_ok "$agent: ~/.agentsearc has THEGRID_API_KEY"
  return 0
}

verify_claude() {
  local failures=0
  verify_agentsearc claude || failures=$((failures + 1))
  if [[ -f "$HOME/.claude/settings.json" ]]; then
    if grep -q 'ANTHROPIC_DEFAULT_SONNET_MODEL' "$HOME/.claude/settings.json"; then
      log_ok "claude: family mapping in settings.json"
    else
      log_err "claude: missing ANTHROPIC_DEFAULT_SONNET_MODEL in settings.json"
      failures=$((failures + 1))
    fi
  else
    log_warn "claude: ~/.claude/settings.json not found (configure may have been skipped)"
  fi
  return "$failures"
}

verify_openclaw() {
  local failures=0
  verify_agentsearc openclaw || failures=$((failures + 1))
  if [[ -f "$HOME/.openclaw/openclaw.json" ]]; then
    if grep -q 'openai-completions' "$HOME/.openclaw/openclaw.json"; then
      log_ok "openclaw: openai-completions provider api"
    else
      log_err "openclaw: expected openai-completions in openclaw.json"
      failures=$((failures + 1))
    fi
    if grep -q '"mode": "merge"' "$HOME/.openclaw/openclaw.json"; then
      log_ok "openclaw: models.mode merge"
    else
      log_err "openclaw: missing models.mode merge"
      failures=$((failures + 1))
    fi
    if grep -q '"mode": "local"' "$HOME/.openclaw/openclaw.json"; then
      log_ok "openclaw: gateway.mode local"
    else
      log_err "openclaw: missing gateway.mode local"
      failures=$((failures + 1))
    fi
  else
    log_warn "openclaw: ~/.openclaw/openclaw.json not found"
  fi
  return "$failures"
}

verify_opencode() {
  local failures=0
  verify_agentsearc opencode || failures=$((failures + 1))
  if [[ -f "$HOME/.config/opencode/opencode.json" ]]; then
    if grep -q 'thegrid' "$HOME/.config/opencode/opencode.json"; then
      log_ok "opencode: thegrid provider in opencode.json"
    else
      log_err "opencode: thegrid provider missing"
      failures=$((failures + 1))
    fi
  else
    log_warn "opencode: ~/.config/opencode/opencode.json not found"
  fi
  return "$failures"
}

verify_kilocode() {
  local failures=0
  verify_agentsearc kilocode || failures=$((failures + 1))
  if grep -q 'KILO_OPEN_ROUTER_API_KEY' "$HOME/.agentsearc" 2>/dev/null; then
    log_err "kilocode: stale KILO_OPEN_ROUTER_API_KEY in .agentsearc"
    failures=$((failures + 1))
  fi
  if [[ -f "$HOME/.config/kilo/kilo.jsonc" ]]; then
    if grep -q '"thegrid"' "$HOME/.config/kilo/kilo.jsonc"; then
      log_ok "kilocode: thegrid provider in kilo.jsonc"
    else
      log_err "kilocode: thegrid provider missing from kilo.jsonc"
      failures=$((failures + 1))
    fi
  else
    log_warn "kilocode: ~/.config/kilo/kilo.jsonc not found"
  fi
  return "$failures"
}

verify_hermes() {
  local failures=0
  verify_agentsearc hermes || failures=$((failures + 1))
  if grep -q '127.0.0.1:4142' "$HOME/.agentsearc" 2>/dev/null; then
    log_err "hermes: local proxy still referenced in .agentsearc"
    failures=$((failures + 1))
  fi
  if [[ -f "$HOME/.hermes/config.yaml" ]]; then
    if grep -q 'api.thegrid.ai' "$HOME/.hermes/config.yaml"; then
      log_ok "hermes: direct Grid base_url in config.yaml"
    else
      log_err "hermes: config.yaml missing api.thegrid.ai base_url"
      failures=$((failures + 1))
    fi
    if grep -q 'api_key: ${THEGRID_API_KEY}' "$HOME/.hermes/config.yaml"; then
      log_ok "hermes: config.yaml references api_key from THEGRID_API_KEY"
    else
      log_err "hermes: config.yaml missing api_key: \${THEGRID_API_KEY}"
      failures=$((failures + 1))
    fi
    if grep -q '127.0.0.1:4142' "$HOME/.hermes/config.yaml" 2>/dev/null; then
      log_err "hermes: local proxy still in config.yaml"
      failures=$((failures + 1))
    fi
  else
    log_warn "hermes: ~/.hermes/config.yaml not found"
  fi
  return "$failures"
}

verify_pi() {
  local failures=0
  verify_agentsearc pi || failures=$((failures + 1))
  if [[ -f "$HOME/.pi/agent/models.json" ]]; then
    if grep -q 'thegrid' "$HOME/.pi/agent/models.json"; then
      log_ok "pi: thegrid provider in models.json"
    else
      log_err "pi: thegrid provider missing"
      failures=$((failures + 1))
    fi
  else
    log_warn "pi: ~/.pi/agent/models.json not found"
  fi
  return "$failures"
}

verify_junie() {
  local failures=0
  verify_agentsearc junie || failures=$((failures + 1))
  if [[ -d "$HOME/.junie/models" ]]; then
    if ls "$HOME/.junie/models"/*.json >/dev/null 2>&1; then
      log_ok "junie: custom model profile present"
    else
      log_warn "junie: no profiles under ~/.junie/models"
    fi
  fi
  return "$failures"
}

verify_codex() {
  verify_agentsearc codex
}

verify_cursor() {
  verify_agentsearc cursor
}

verify_t3code() {
  verify_agentsearc t3code
}

assert_local_tool_file() {
  if [[ "${USE_CHAT_INPUT_TEST:-0}" = "1" ]]; then
    log_warn "tool file assertion skipped (USE_CHAT_INPUT_TEST=1)"
    return 0
  fi
  if [[ -f "$TOOL_INPUT_TEST_FILE" ]] && grep -qFx "$TOOL_INPUT_TEST_MARKER" "$TOOL_INPUT_TEST_FILE"; then
    log_ok "tool file present: $TOOL_INPUT_TEST_FILE"
    return 0
  fi
  log_err "tool file missing or wrong content: $TOOL_INPUT_TEST_FILE"
  ls -la "$TOOL_INPUT_TEST_FILE" 2>&1 || true
  cat "$TOOL_INPUT_TEST_FILE" 2>&1 || true
  return 1
}

verify_local_agent() {
  local agent="$1"
  local fn="verify_${agent}"
  if declare -f "$fn" >/dev/null 2>&1; then
    "$fn"
  else
    log_warn "$agent: no verify_local handler — skipping"
    return 0
  fi
}
