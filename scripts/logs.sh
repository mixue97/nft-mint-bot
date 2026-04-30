#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Follow the bot's log file. Ctrl+C to stop following (does NOT stop the bot).
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/mint.log"

if [[ ! -f "$LOG_FILE" ]]; then
  printf 'no log file at %s yet - is the bot running?\n' "$LOG_FILE" >&2
  exit 1
fi

exec tail -F "$LOG_FILE"
