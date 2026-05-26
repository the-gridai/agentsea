#!/bin/bash
# Sync CDN artifacts from the monorepo root into packages/ui/public/
# so Vercel serves them alongside the Next.js UI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${UI_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"

# Always refresh from repo root to keep public/ in sync
mkdir -p "${UI_DIR}/public/assets"

rm -f "${UI_DIR}/public/manifest.json"
cp "${REPO_ROOT}/manifest.json" "${UI_DIR}/public/manifest.json"

rm -rf "${UI_DIR}/public/sh"
cp -R "${REPO_ROOT}/sh" "${UI_DIR}/public/sh"

# assets/ already has agent and cloud images for the UI;
# sync from repo root to include any newer or additional images.
rm -rf "${UI_DIR}/public/assets"
cp -R "${REPO_ROOT}/assets" "${UI_DIR}/public/assets"

echo "[sync-cdn-public] synced manifest.json, sh/, assets/ → packages/ui/public/"
