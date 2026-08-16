#!/bin/bash
# Desk Health Coach — long-running parent loop. Registered as the ProgramArguments target of
# the per-user LaunchAgent (RunAtLoad + KeepAlive). Heartbeats roughly once a minute, hands any
# due reminder to a detached dialog.js child, and never waits on that child.
set -u
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB="$SCRIPT_DIR/lib.js"
TICK="$SCRIPT_DIR/tick.js"
DIALOG="$SCRIPT_DIR/dialog.js"
ERR_LOG="$SCRIPT_DIR/runner-error.log"

trap 'exit 0' TERM INT

while true; do
  umask 077

  MODE="live"
  if [ -f "$SCRIPT_DIR/mode" ]; then
    MODE="$(tr -d '[:space:]' < "$SCRIPT_DIR/mode")"
  fi

  OUT="$(osascript -l JavaScript -e "$(cat "$LIB")" -e "$(cat "$TICK")" -- "$BASE_DIR" "$MODE" '{}' 2>>"$ERR_LOG")"

  case "$OUT" in
    "SHOW_DIALOG "*)
      REQ_PATH="${OUT#SHOW_DIALOG }"
      ( osascript -l JavaScript -e "$(cat "$LIB")" -e "$(cat "$DIALOG")" -- "$REQ_PATH" >>"$ERR_LOG" 2>&1 & )
      ;;
    "FAIL_CLOSED "*)
      printf '%s FAIL_CLOSED %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${OUT#FAIL_CLOSED }" >> "$ERR_LOG"
      ;;
    *) ;;
  esac

  sleep 60
done
