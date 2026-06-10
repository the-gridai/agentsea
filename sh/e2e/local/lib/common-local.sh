#!/usr/bin/env bash
# e2e/local/lib/common-local.sh — constants for local E2E (no cloud SSH)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
export AGENTSEA_CLI_DIR="${AGENTSEA_CLI_DIR:-$ROOT}"

ALL_AGENTS="claude openclaw codex opencode kilocode hermes junie cursor pi t3code"
TOOL_INPUT_TEST_FILE="/tmp/agentsea-e2e-tool.txt"
TOOL_INPUT_TEST_MARKER="TOOL_E2E_OK"
CHAT_INPUT_TEST_PROMPT="Reply with exactly the text AGENTSEA_E2E_OK and nothing else."
CHAT_INPUT_TEST_MARKER="AGENTSEA_E2E_OK"
if [[ "${USE_CHAT_INPUT_TEST:-0}" = "1" ]]; then
  INPUT_TEST_MARKER="${INPUT_TEST_MARKER:-${CHAT_INPUT_TEST_MARKER}}"
  INPUT_TEST_PROMPT="${INPUT_TEST_PROMPT:-${CHAT_INPUT_TEST_PROMPT}}"
else
  INPUT_TEST_MARKER="${INPUT_TEST_MARKER:-${TOOL_INPUT_TEST_MARKER}}"
  INPUT_TEST_PROMPT="${INPUT_TEST_PROMPT:-Use your file or shell tools to create the absolute path file ${TOOL_INPUT_TEST_FILE} containing exactly one line: ${TOOL_INPUT_TEST_MARKER}. You must write the file on disk — a chat reply alone is not sufficient.}"
fi
INPUT_TEST_TIMEOUT="${INPUT_TEST_TIMEOUT:-240}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { printf '%b[local-e2e] %s%b\n' "$BLUE" "$*" "$NC"; }
log_ok() { printf '%b[local-e2e] OK: %s%b\n' "$GREEN" "$*" "$NC"; }
log_warn() { printf '%b[local-e2e] WARN: %s%b\n' "$YELLOW" "$*" "$NC"; }
log_err() { printf '%b[local-e2e] ERR: %s%b\n' "$RED" "$*" "$NC"; }
