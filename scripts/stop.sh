#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Stop the bot's tmux session.
# Exit codes:
#   0  stopped (or already stopped)
# -----------------------------------------------------------------------------
set -euo pipefail

SESSION="mint"

log() { printf '\033[1;36m[stop]\033[0m %s\n' "$*"; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  log "session '$SESSION' killed"
else
  log "session '$SESSION' not running - nothing to do"
fi
