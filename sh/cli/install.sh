#!/bin/bash
# Installer for the agentsea CLI
#
# Usage:
#   curl -fsSL --proto '=https' https://spawn.thegrid.ai/cli/install.sh | bash
#   curl -fsSL --proto '=https' https://spawn.thegrid.ai/cli/install.sh | bash -s -- openclaw digitalocean
#
# This installs agentsea via bun. If bun is not available, it auto-installs it first.
# With agent and cloud arguments, installs then runs `agentsea <agent> <cloud>` interactively.
#
# Override install directory:
#   AGENTSEA_INSTALL_DIR=/usr/local/bin curl -fsSL --proto '=https' ... | bash

set -eo pipefail

# Optional launch target when invoked as: curl ... | bash -s -- <agent> <cloud>
AGENTSEA_LAUNCH_AGENT="${1:-}"
AGENTSEA_LAUNCH_CLOUD="${2:-}"
INSTALL_DIR=""

AGENTSEA_REPO="the-gridai/agentsea"
# Origin this installer + the agentsea CLI fetch scripts from. Per-environment
# deploys (dev/staging/prod) replace AGENTSEA_CDN_DEFAULT below at build time via
# packages/ui/scripts/sync-cdn-public.sh (from NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN).
# Users can override at runtime by exporting AGENTSEA_CDN before running this.
AGENTSEA_CDN_DEFAULT="https://agentsea.dev.thegrid.ai"
AGENTSEA_CDN="${AGENTSEA_CDN:-$AGENTSEA_CDN_DEFAULT}"
AGENTSEA_RAW_BASE="https://raw.githubusercontent.com/${AGENTSEA_REPO}/main"
MIN_BUN_VERSION="1.2.0"
BUN_INSTALL_VERSION="1.3.9"
# SHA-256 of https://bun.sh/install?version=1.3.9 — update when bumping BUN_INSTALL_VERSION
BUN_INSTALLER_SHA256="bab8acfb046aac8c72407bdcce903957665d655d7acaa3e11c7c4616beae68dd"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

CYAN='\033[0;36m'

log_info()  { printf '%b[agentsea]%b %s\n' "$GREEN" "$NC" "$1"; }
log_step()  { printf '%b[agentsea]%b %s\n' "$CYAN" "$NC" "$1"; }
log_warn()  { printf '%b[agentsea]%b %s\n' "$YELLOW" "$NC" "$1"; }
log_error() { printf '%b[agentsea]%b %s\n' "$RED" "$NC" "$1"; }

# --- Helper: portable SHA-256 (macOS uses shasum, Linux uses sha256sum) ---
sha256_file() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        return 1
    fi
}

# --- Helper: compare semver strings ---
# Returns 0 (true) if $1 >= $2
version_gte() {
    local IFS='.'
    local a=($1) b=($2)
    local i=0
    while [ $i -lt ${#b[@]} ]; do
        local av="${a[$i]:-0}"
        local bv="${b[$i]:-0}"
        if [ "$av" -lt "$bv" ]; then
            return 1
        elif [ "$av" -gt "$bv" ]; then
            return 0
        fi
        i=$((i + 1))
    done
    return 0
}

# --- Helper: ensure bun meets minimum version ---
ensure_min_bun_version() {
    local current
    current="$(bun --version)"
    if ! version_gte "$current" "$MIN_BUN_VERSION"; then
        log_warn "bun ${current} is below minimum ${MIN_BUN_VERSION}, upgrading..."
        bun upgrade
        current="$(bun --version)"
        if ! version_gte "$current" "$MIN_BUN_VERSION"; then
            log_error "Failed to upgrade bun to >= ${MIN_BUN_VERSION} (got ${current})"
            echo ""
            echo "Please upgrade bun manually:"
            echo "  bun upgrade"
            echo ""
            echo "Then re-run:"
            echo "  curl -fsSL --proto '=https' ${AGENTSEA_CDN}/cli/install.sh | bash"
            exit 1
        fi
        log_info "bun upgraded to ${current}"
    fi
}

# --- Helper: check if sudo can authenticate without a password prompt ---
# Returns 0 if sudo is passwordless (root, NOPASSWD, or macOS Touch ID).
has_passwordless_sudo() {
    # Already root — no sudo needed
    [ "$(id -u)" = "0" ] && return 0
    # Check if sudo works non-interactively (NOPASSWD or cached credentials)
    sudo -n true 2>/dev/null && return 0
    # macOS: check if Touch ID is configured for sudo (pam_tid.so)
    if [ -f /etc/pam.d/sudo_local ] && grep -q "pam_tid" /etc/pam.d/sudo_local 2>/dev/null; then
        return 0
    fi
    if [ -f /etc/pam.d/sudo ] && grep -q "pam_tid" /etc/pam.d/sudo 2>/dev/null; then
        return 0
    fi
    return 1
}

# --- Helper: verify symlink target is safe before overwriting ---
# Returns 0 if the path doesn't exist, is not a symlink, or points to a safe location.
# Returns 1 if it's a symlink pointing to an unexpected location (potential hijack).
# Safe prefixes: $HOME/.local, $HOME/.bun, /usr/local, $HOME/.npm-global
verify_symlink_safe() {
    local target_path="$1"
    # No file at all — safe to create
    if [ ! -e "$target_path" ] && [ ! -L "$target_path" ]; then
        return 0
    fi
    # Not a symlink (regular file or dir) — safe to overwrite with -f
    if [ ! -L "$target_path" ]; then
        return 0
    fi
    # It's a symlink — read where it points (portable: readlink without -f)
    local link_target
    link_target="$(readlink "$target_path" 2>/dev/null || true)"
    if [ -z "$link_target" ]; then
        # Could not read symlink — treat as suspicious
        return 1
    fi
    # Check against safe prefixes
    case "$link_target" in
        "${HOME}/.local/"*|"${HOME}/.bun/"*|"/usr/local/"*|"${HOME}/.npm-global/"*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# --- Helper: create symlink only if existing target is safe ---
# Usage: safe_ln_sf <source> <dest> [sudo]
# Warns and skips if dest is a symlink pointing to an unexpected location.
safe_ln_sf() {
    local src="$1"
    local dest="$2"
    local use_sudo="${3:-}"
    local name
    name="$(basename "$dest")"
    if ! verify_symlink_safe "$dest"; then
        local existing
        existing="$(readlink "$dest" 2>/dev/null || true)"
        log_warn "Skipping ${dest}: existing symlink points to unexpected location (${existing})"
        log_warn "Remove it manually if you trust the target: rm ${dest}"
        return 1
    fi
    if [ "$use_sudo" = "sudo" ]; then
        sudo ln -sf "$src" "$dest"
    else
        ln -sf "$src" "$dest"
    fi
}

# --- Helper: ensure agentsea works immediately and in future sessions ---
# Installs to ~/.local/bin. If that's not already in PATH, also symlinks
# to /usr/local/bin for immediate availability (without prompting for a
# password — only if writable or passwordless sudo is available).
# Also patches shell rc files so both ~/.local/bin and ~/.bun/bin are in
# PATH for future sessions (bun is required by agentsea's shebang).
ensure_in_path() {
    local install_dir="$1"
    local bun_bin_dir="${BUN_INSTALL}/bin"

    # 1. Check if install_dir and bun are already in the user's real PATH
    local agentsea_in_path=false
    local bun_in_path=false
    if echo "${_AGENTSEA_ORIG_PATH}" | tr ':' '\n' | grep -qxF "${install_dir}"; then
        agentsea_in_path=true
    fi
    if echo "${_AGENTSEA_ORIG_PATH}" | tr ':' '\n' | grep -qxF "${bun_bin_dir}"; then
        bun_in_path=true
    fi

    # 2. If agentsea not in PATH, symlink into /usr/local/bin for immediate availability
    #    Try in order: direct write → passwordless sudo → prompt for password
    #    Also symlink bun so that agentsea's #!/usr/bin/env bun shebang resolves
    local linked=false
    local bun_path
    bun_path="$(command -v bun 2>/dev/null || true)"
    # Validate bun is in an expected directory before symlinking with elevated
    # privileges. If an attacker controls PATH, `command -v bun` could resolve
    # to a malicious binary — symlinking that to /usr/local/bin with sudo would
    # be a privilege escalation vector.
    if [ -n "$bun_path" ]; then
        case "$bun_path" in
            "${HOME}/.bun/bin/bun"|"${HOME}/.local/bin/bun"|/usr/local/bin/bun|"${BUN_INSTALL}/bin/bun")
                # Expected bun installation location — safe to symlink
                ;;
            *)
                log_warn "bun found at unexpected location: ${bun_path} — skipping symlink"
                bun_path=""
                ;;
        esac
    fi
    if [ "$agentsea_in_path" = false ]; then
        if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
            safe_ln_sf "${install_dir}/agentsea" /usr/local/bin/agentsea && linked=true
            if [ -n "$bun_path" ] && [ ! -x /usr/local/bin/bun ]; then
                safe_ln_sf "$bun_path" /usr/local/bin/bun 2>/dev/null || true
            fi
        elif has_passwordless_sudo; then
            safe_ln_sf "${install_dir}/agentsea" /usr/local/bin/agentsea sudo 2>/dev/null && linked=true
            if [ -n "$bun_path" ] && [ ! -x /usr/local/bin/bun ]; then
                safe_ln_sf "$bun_path" /usr/local/bin/bun sudo 2>/dev/null || true
            fi
        elif command -v sudo &>/dev/null; then
            # Last resort: ask for password
            log_step "Adding agentsea to /usr/local/bin (may require your password)..."
            safe_ln_sf "${install_dir}/agentsea" /usr/local/bin/agentsea sudo && linked=true || true
            if [ "$linked" = true ] && [ -n "$bun_path" ] && [ ! -x /usr/local/bin/bun ]; then
                safe_ln_sf "$bun_path" /usr/local/bin/bun sudo 2>/dev/null || true
            fi
        fi
    fi

    # 3. Patch shell rc files so both ~/.local/bin and ~/.bun/bin are in PATH
    #    for future sessions. ~/.bun/bin is required by agentsea's #!/usr/bin/env bun shebang.
    local rc_file=""
    case "${SHELL:-/bin/bash}" in
        */zsh)  rc_file="${HOME}/.zshrc" ;;
        */fish) rc_file="" ;;
        *)      rc_file="${HOME}/.bashrc" ;;
    esac

    # Marker comments — keep in sync with packages/cli/src/shared/paths.ts
    local marker_start="# >>> agentsea >>>"
    local marker_end="# <<< agentsea <<<"

    # Helper: add a dir to rc files if not already present
    _patch_rc() {
        local dir="$1"
        local line="export PATH=\"${dir}:\$PATH\""
        if [ -n "$rc_file" ]; then
            if ! grep -qF "${dir}" "$rc_file" 2>/dev/null; then
                printf '\n%s\n%s\n%s\n' "$marker_start" "$line" "$marker_end" >> "$rc_file"
            fi
            case "${SHELL:-/bin/bash}" in */bash)
                for profile in "${HOME}/.profile" "${HOME}/.bash_profile"; do
                    if [ -f "$profile" ] && ! grep -qF "${dir}" "$profile" 2>/dev/null; then
                        printf '\n%s\n%s\n%s\n' "$marker_start" "$line" "$marker_end" >> "$profile"
                    fi
                done
            ;; esac
        else
            case "${SHELL:-}" in */fish)
                fish -c "fish_add_path \"${dir}\"" 2>/dev/null || true
            ;; esac
        fi
    }

    if [ "$agentsea_in_path" = false ]; then
        _patch_rc "${install_dir}"
    fi
    if [ "$bun_in_path" = false ]; then
        _patch_rc "${bun_bin_dir}"
    fi

    # 4. Show version and success message
    echo ""
    AGENTSEA_NO_UPDATE_CHECK=1 PATH="${install_dir}:${PATH}" "${install_dir}/agentsea" version
    echo ""
    local all_ready=true
    if [ "$agentsea_in_path" = false ] && [ "$linked" = false ]; then
        all_ready=false
    fi
    if [ "$bun_in_path" = false ] && [ ! -x /usr/local/bin/bun ]; then
        all_ready=false
    fi
    if [ "$all_ready" = true ]; then
        printf '%b[agentsea]%b Run %bagentsea%b to get started\n' "$GREEN" "$NC" "$BOLD" "$NC"
    else
        printf '%b[agentsea]%b Add agentsea to your PATH for this session:\n' "$GREEN" "$NC"
        echo ""
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
        echo "  Or reopen your terminal if ~/.bashrc / ~/.zshrc was updated."
        echo ""
    fi
}

# --- Helper: validate agent/cloud slugs before auto-launch ---
validate_launch_slug() {
    local label="$1"
    local value="$2"
    if ! [[ "$value" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
        log_error "Invalid ${label}: ${value}"
        echo "Use lowercase letters, digits, and hyphens only (e.g. hermes, local)."
        exit 1
    fi
}

launch_agentsea_if_requested() {
    if [ -z "${AGENTSEA_LAUNCH_AGENT}" ] && [ -z "${AGENTSEA_LAUNCH_CLOUD}" ]; then
        return 0
    fi
    if [ -z "${AGENTSEA_LAUNCH_AGENT}" ] || [ -z "${AGENTSEA_LAUNCH_CLOUD}" ]; then
        log_error "Both agent and cloud are required to auto-launch after install"
        echo "Example: curl -fsSL .../install.sh | bash -s -- hermes local"
        exit 1
    fi
    validate_launch_slug "agent" "${AGENTSEA_LAUNCH_AGENT}"
    validate_launch_slug "cloud" "${AGENTSEA_LAUNCH_CLOUD}"

    local bin="${INSTALL_DIR}/agentsea"
    if [ ! -x "$bin" ]; then
        log_error "agentsea binary not found at ${bin}"
        exit 1
    fi

    echo ""
    log_step "Install complete — starting agentsea ${AGENTSEA_LAUNCH_AGENT} ${AGENTSEA_LAUNCH_CLOUD}..."
    echo ""
    export PATH="${INSTALL_DIR}:${BUN_INSTALL}/bin:${HOME}/.local/bin:/usr/local/bin:${PATH}"
    # curl | bash pipes the script on stdin; after install, reattach the user's TTY
    # so agentsea can prompt for DigitalOcean / Grid API keys interactively.
    if [ -r /dev/tty ]; then
        exec 0</dev/tty
    fi
    AGENTSEA_NO_UPDATE_CHECK=1 exec "${bin}" "${AGENTSEA_LAUNCH_AGENT}" "${AGENTSEA_LAUNCH_CLOUD}"
}

# --- Helper: build and install the CLI using bun ---
build_and_install() {
    tmpdir=$(mktemp -d)
    [ -n "$tmpdir" ] || { log_error "mktemp failed to produce a directory path"; exit 1; }
    trap '[ -n "${tmpdir}" ] && [ -d "${tmpdir}" ] && rm -rf "${tmpdir}"' EXIT

    log_step "Downloading pre-built CLI binary..."
    curl -fsSL --proto '=https' "https://github.com/${AGENTSEA_REPO}/releases/download/cli-latest/cli.js" -o "${tmpdir}/cli.js"
    if [ ! -s "${tmpdir}/cli.js" ]; then
        log_error "Failed to download pre-built binary"
        exit 1
    fi

    if [ -n "${AGENTSEA_INSTALL_DIR:-}" ]; then
        case "${AGENTSEA_INSTALL_DIR}" in
            /*) ;;  # absolute path OK
            *) log_error "AGENTSEA_INSTALL_DIR must be an absolute path"; exit 1 ;;
        esac
        case "${AGENTSEA_INSTALL_DIR}" in
            *..*) log_error "AGENTSEA_INSTALL_DIR must not contain .. path components"; exit 1 ;;
        esac
    fi
    INSTALL_DIR="${AGENTSEA_INSTALL_DIR:-${HOME}/.local/bin}"
    mkdir -p "${INSTALL_DIR}"
    cp "${tmpdir}/cli.js" "${INSTALL_DIR}/agentsea"
    chmod +x "${INSTALL_DIR}/agentsea"

    log_info "Installed agentsea to ${INSTALL_DIR}/agentsea"
    ensure_in_path "${INSTALL_DIR}"
}

# --- Locate or install bun ---
# Save original PATH before modifications so ensure_in_path() can check
# whether the install dir is already in the user's real PATH.
_AGENTSEA_ORIG_PATH="${PATH}"
# When running via `curl | bash`, subshells may not inherit PATH updates,
# so we always prepend the standard bun install locations explicitly.
export BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"
export PATH="${BUN_INSTALL}/bin:${HOME}/.local/bin:${PATH}"

# Check that bun exists AND actually works. Some platforms (e.g. Sprite)
# have a bun shim that delegates to $HOME/.bun/bin/bun — if that binary
# doesn't exist, `command -v bun` returns 0 but `bun --version` fails.
if ! bun --version &>/dev/null; then
    log_step "bun not found or not working. Installing bun..."

    # Download the bun installer to a temp file and verify its SHA-256 hash
    # before executing. This defends against a compromised bun.sh CDN or
    # DNS hijack serving a tampered install script.
    _bun_installer=$(mktemp)
    curl -fsSL --proto '=https' "https://bun.sh/install?version=${BUN_INSTALL_VERSION}" -o "$_bun_installer"
    _bun_hash="$(sha256_file "$_bun_installer" 2>/dev/null || true)"
    if [ -z "$_bun_hash" ]; then
        log_warn "Cannot verify bun installer (no sha256sum/shasum available), executing unverified"
    elif [ "$_bun_hash" != "$BUN_INSTALLER_SHA256" ]; then
        rm -f "$_bun_installer"
        log_error "bun installer hash mismatch — possible supply chain attack"
        log_error "Expected: ${BUN_INSTALLER_SHA256}"
        log_error "Got:      ${_bun_hash}"
        echo ""
        echo "The bun installer from bun.sh does not match the expected hash."
        echo "This could indicate a compromised CDN or DNS hijack."
        echo ""
        echo "If bun has released a new installer, please report this at:"
        echo "  https://github.com/${AGENTSEA_REPO}/issues"
        exit 1
    fi
    bash "$_bun_installer"
    rm -f "$_bun_installer"

    # Re-export so bun is available in this session immediately.
    # Use hard-coded paths alongside BUN_INSTALL — the bun installer may
    # have placed the binary in $HOME/.bun/bin even if BUN_INSTALL differs.
    export PATH="$HOME/.bun/bin:${BUN_INSTALL}/bin:$HOME/.local/bin:${PATH}"

    if ! command -v bun &>/dev/null; then
        log_error "Failed to install bun automatically"
        echo ""
        echo "Please install bun manually:"
        echo "  curl -fsSL --proto '=https' https://bun.sh/install?version=${BUN_INSTALL_VERSION} | bash"
        echo ""
        echo "Then reopen your terminal and re-run:"
        echo "  curl -fsSL --proto '=https' ${AGENTSEA_CDN}/cli/install.sh | bash"
        exit 1
    fi

    log_info "bun installed successfully"
fi

ensure_min_bun_version

log_step "Installing agentsea via bun..."
build_and_install

# Pin the CDN origin this CLI was installed from so `agentsea` fetches scripts and
# one-liners from the same environment (dev/staging/prod) without needing
# AGENTSEA_CDN exported. The CLI reads this file (env var still takes precedence).
_cdn_dir="${AGENTSEA_HOME:-${HOME}/.config/agentsea}"
if mkdir -p "${_cdn_dir}" 2>/dev/null; then
    printf '%s\n' "${AGENTSEA_CDN}" > "${_cdn_dir}/cdn-origin" 2>/dev/null || true
fi

# Persist install referrer (e.g. AGENTSEA_REF=reddit) so the CLI can report
# attribution on first run. Only written once — never overwritten on updates.
if [ -n "${AGENTSEA_REF:-}" ]; then
    _ref_dir="${HOME}/.config/agentsea"
    _ref_file="${_ref_dir}/.ref"
    if [ ! -f "${_ref_file}" ]; then
        mkdir -p "${_ref_dir}"
        # Sanitize: allow only alphanumeric, hyphens, underscores (no injection)
        _clean_ref=$(printf '%s' "${AGENTSEA_REF}" | tr -cd 'a-zA-Z0-9_-' | head -c 32)
        if [ -n "${_clean_ref}" ]; then
            printf '%s' "${_clean_ref}" > "${_ref_file}"
            log_info "Install referrer: ${_clean_ref}"
        fi
    fi
fi

launch_agentsea_if_requested
