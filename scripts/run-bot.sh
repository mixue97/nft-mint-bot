#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Launch the mint bot in a detached tmux session.
#
# Usage:
#     bash scripts/run-bot.sh             # real run
#     bash scripts/run-bot.sh --dry-run   # safe dry-run, no broadcast
#     bash scripts/run-bot.sh --simulate  # alias for --dry-run
#
# After it returns, check progress with:
#     bash scripts/status.sh
#     bash scripts/logs.sh
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SESSION="mint"
LOG_FILE="$REPO_DIR/mint.log"
ENV_FILE="$REPO_DIR/.env"

DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|--simulate) DRY_RUN="--dry-run" ;;
    *) printf 'unknown arg: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m[run]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[run]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[run]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 1. pre-flight ---------------------------------------------------------
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found - copy .env.example to .env first"
command -v tmux >/dev/null 2>&1 || die "tmux not installed - run scripts/setup-vps.sh"
command -v node >/dev/null 2>&1 || die "node not installed - run scripts/setup-vps.sh"
[[ -d node_modules ]] || die "node_modules missing - run 'npm install' or scripts/setup-vps.sh"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  die "tmux session '$SESSION' already exists - stop it with scripts/stop.sh first"
fi

# Validate critical env vars without echoing the private key.
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

[[ "${PRIVATE_KEY:-}" == 0x* && ${#PRIVATE_KEY} -eq 66 ]] \
  || die "PRIVATE_KEY missing or malformed in .env (expect 0x + 64 hex chars)"

[[ "${RPC_URLS:-}" =~ ^https?:// ]] || die "RPC_URLS missing in .env"
[[ "${NFT_CONTRACT:-}" == 0x* ]]    || die "NFT_CONTRACT missing in .env"

if [[ -z "$DRY_RUN" ]]; then
  ts="${MINT_TIMESTAMP:-0}"
  if [[ "$ts" =~ ^[0-9]+$ && "$ts" -gt 0 ]]; then
    now=$(date -u +%s)
    delta=$((ts - now))
    if (( delta < -60 )); then
      die "MINT_TIMESTAMP is $((-delta))s in the past - update .env"
    fi
    log "MINT_TIMESTAMP fires in ${delta}s ($(date -u -d "@$ts" 2>/dev/null || true))"
  else
    warn "MINT_TIMESTAMP=0 - bot will fire IMMEDIATELY when tmux starts"
  fi
fi

# ---- 2. clock check ---------------------------------------------------------
if command -v chronyc >/dev/null 2>&1; then
  offset_line=$(chronyc tracking 2>/dev/null | awk -F': *' '/System time/ {print $2}' | head -n1 || true)
  [[ -n "$offset_line" ]] && log "clock offset: $offset_line"
fi

# ---- 3. archive previous log -----------------------------------------------
if [[ -f "$LOG_FILE" ]]; then
  mv "$LOG_FILE" "$LOG_FILE.$(date -u +%Y%m%dT%H%M%SZ)"
fi

# ---- 4. spawn tmux ---------------------------------------------------------
log "starting tmux session '$SESSION'..."
tmux new-session -d -s "$SESSION" -x 200 -y 50 \
  "cd $REPO_DIR && npm start -- $DRY_RUN 2>&1 | tee '$LOG_FILE'"

sleep 1
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  die "tmux session died immediately - check $LOG_FILE"
fi

pid=$(tmux list-panes -t "$SESSION" -F '#{pane_pid}' | head -n1)
log "tmux session PID = ${pid:-unknown}"
log "log file         = $LOG_FILE"
log ""
log "next steps:"
log "  bash scripts/status.sh   # quick status"
log "  bash scripts/logs.sh     # follow log"
log "  bash scripts/stop.sh     # stop the bot"
