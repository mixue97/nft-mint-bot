#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Report whether the bot is running and tail the last N log lines.
#
# Usage:  bash scripts/status.sh [N]    (default N = 30)
# Exit codes:
#   0  bot is running
#   1  no tmux session
#   2  log file missing
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SESSION="mint"
LOG_FILE="$REPO_DIR/mint.log"
N="${1:-30}"

log()  { printf '\033[1;36m[status]\033[0m %s\n' "$*"; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
  pid=$(tmux list-panes -t "$SESSION" -F '#{pane_pid}' | head -n1)
  log "session '$SESSION' is RUNNING (pid=${pid:-?})"
  rc=0
else
  log "session '$SESSION' is NOT RUNNING"
  rc=1
fi

if [[ -f "$LOG_FILE" ]]; then
  log "last $N log lines from $LOG_FILE:"
  echo "----------------------------------------------------------------------"
  tail -n "$N" "$LOG_FILE"
  echo "----------------------------------------------------------------------"
else
  log "no log file at $LOG_FILE yet"
  [[ "$rc" -eq 1 ]] && rc=2
fi

exit "$rc"
