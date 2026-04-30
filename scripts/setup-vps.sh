#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# One-shot VPS setup for nft-mint-bot.
#
# Tested on Debian 12 / Ubuntu 22.04 / Ubuntu 24.04. Run from the repo root:
#
#     bash scripts/setup-vps.sh
#
# It is idempotent - safe to re-run.
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log()  { printf '\033[1;36m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 0. sanity checks -------------------------------------------------------
if [[ "$EUID" -eq 0 ]]; then
  warn "running as root - sudo prefix will be skipped"
  SUDO=""
else
  SUDO="sudo"
fi

if ! command -v "$SUDO" >/dev/null 2>&1 && [[ -n "$SUDO" ]]; then
  die "sudo not found - install sudo or run this script as root"
fi

# ---- 1. apt packages --------------------------------------------------------
log "installing apt packages (curl, ca-certificates, tmux, chrony, unzip)..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq curl ca-certificates tmux chrony unzip jq

# ---- 2. Node.js 20 ----------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  ver=$(node --version 2>/dev/null | sed 's/^v//')
  major=${ver%%.*}
  if [[ "$major" -ge 20 ]]; then
    log "node v$ver already installed - skipping"
    need_node=0
  fi
fi

if [[ "$need_node" -eq 1 ]]; then
  log "installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs
fi

log "node    = $(node --version)"
log "npm     = $(npm --version)"

# ---- 3. NTP sync ------------------------------------------------------------
log "enabling chrony for NTP sync..."
$SUDO systemctl enable --now chrony >/dev/null 2>&1 || \
  $SUDO systemctl enable --now chronyd >/dev/null 2>&1 || \
  warn "chrony service not found - check 'systemctl list-unit-files | grep -i chrony'"

if command -v chronyc >/dev/null 2>&1; then
  offset=$(chronyc tracking 2>/dev/null | awk -F': *' '/System time/ {print $2}' | head -n1)
  log "chrony  = ${offset:-unknown}"
fi

# ---- 4. npm install ---------------------------------------------------------
log "running npm install..."
npm install --silent --no-audit --no-fund

# ---- 5. summary -------------------------------------------------------------
log "==============================================================="
log " setup complete."
log " repo at:   $REPO_DIR"
log " next:      cp .env.example .env && \$EDITOR .env"
log "            bash scripts/run-bot.sh"
log "==============================================================="
