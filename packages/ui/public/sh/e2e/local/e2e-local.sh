#!/usr/bin/env bash
# Local E2E pyramid — contract (Tier 1), config (Tier 2), integration (Tier 3).
# Usage:
#   ./sh/e2e/local/e2e-local.sh [--tier contract|config|integration] [agent ...]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common-local.sh
source "$SCRIPT_DIR/lib/common-local.sh"
# shellcheck source=lib/verify-local.sh
source "$SCRIPT_DIR/lib/verify-local.sh"

TIER="config"
AGENTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      TIER="${2:-}"
      shift 2
      ;;
    --tier=*)
      TIER="${1#*=}"
      shift
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--tier contract|config|integration] [agent ...]

Tiers:
  contract     bun test src/__tests__/e2e only (no installs)
  config       contract + filesystem verify on current \$HOME (default)
  integration  config + headless prompt with real THEGRID_API_KEY

Env:
  THEGRID_API_KEY   required for integration tier (optional for config with mock key)
  AGENTSEA_E2E_HOME isolate HOME per agent (integration)
EOF
      exit 0
      ;;
    *)
      AGENTS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#AGENTS[@]} -eq 0 ]]; then
  # shellcheck disable=SC2206
  AGENTS=($ALL_AGENTS)
fi

run_contract_tier() {
  log_step "Tier 1 — contract tests (bun test src/__tests__/e2e)"
  cd "$ROOT/packages/cli"
  bun test src/__tests__/e2e
}

run_config_tier_for_agent() {
  local agent="$1"
  log_step "Tier 2 — config verify for $agent"
  verify_local_agent "$agent"
}

run_integration_tier_for_agent() {
  local agent="$1"
  if [[ -z "${THEGRID_API_KEY:-}" ]]; then
    log_err "THEGRID_API_KEY required for integration tier"
    exit 1
  fi

  local e2e_home="${AGENTSEA_E2E_HOME:-}"
  if [[ -n "$e2e_home" ]]; then
    export HOME="$e2e_home"
    mkdir -p "$HOME"
  fi

  log_step "Tier 3 — provision + prompt for $agent"
  export AGENTSEA_NON_INTERACTIVE=1
  export AGENTSEA_HEADLESS=1
  export AGENTSEA_PROMPT="$INPUT_TEST_PROMPT"
  export THEGRID_API_KEY

  cd "$ROOT/packages/cli"
  bun run src/local/main.ts "$agent"

  verify_local_agent "$agent" || return 1

  log_step "Tier 3 — assert tool file after headless prompt for $agent"
  assert_local_tool_file || return 1

  log_ok "$agent: integration provision + tool E2E file assertion passed"
}

case "$TIER" in
  contract)
    run_contract_tier
    ;;
  config)
    run_contract_tier
    failures=0
    for agent in "${AGENTS[@]}"; do
      run_config_tier_for_agent "$agent" || failures=$((failures + 1))
    done
    if [[ "$failures" -gt 0 ]]; then
      log_err "config tier failed for $failures agent(s)"
      exit 1
    fi
    ;;
  integration)
    run_contract_tier
    failures=0
    for agent in "${AGENTS[@]}"; do
      if [[ "$agent" == "cursor" || "$agent" == "codex" || "$agent" == "t3code" || "$agent" == "junie" || "$agent" == "pi" ]]; then
        log_warn "cursor/codex/t3code/junie/pi: disabled in manifest (tool loops broken or unverified on Grid)"
        continue
      fi
      run_integration_tier_for_agent "$agent" || failures=$((failures + 1))
    done
    if [[ "$failures" -gt 0 ]]; then
      log_err "integration tier failed for $failures agent(s)"
      exit 1
    fi
    ;;
  *)
    log_err "unknown tier: $TIER"
    exit 1
    ;;
esac

log_ok "local E2E tier=$TIER complete"
