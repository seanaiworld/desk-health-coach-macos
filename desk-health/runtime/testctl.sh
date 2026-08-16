#!/bin/bash
# Usage:
#   testctl.sh status
#   testctl.sh fire <type>
#   testctl.sh scenario <pause|quiet|dialog-busy|unshown|wake-gap|collision|streak>
# Test-mode-only control surface behind /desk-health test *. Refuses to run unless
# runtime/mode is "test" and data/test-runs/.current exists.
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CMD="${1:?usage: testctl.sh status|fire|scenario ...}"
SUB="${2:-}"

OUT="$(osascript -l JavaScript -e "$(cat "$SCRIPT_DIR/lib.js")" -e "$(cat "$SCRIPT_DIR/tick.js")" -e "$(cat "$SCRIPT_DIR/testctl.js")" -- "$BASE_DIR" "$CMD" "$SUB")"
echo "$OUT"

if [ "$CMD" = "fire" ]; then
  case "$OUT" in
    *'"directive":"SHOW_DIALOG"'*)
      REQ_PATH="$(printf '%s' "$OUT" | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"
      if [ -n "$REQ_PATH" ]; then
        ( osascript -l JavaScript -e "$(cat "$SCRIPT_DIR/lib.js")" -e "$(cat "$SCRIPT_DIR/dialog.js")" -- "$REQ_PATH" >>"$SCRIPT_DIR/runner-error.log" 2>&1 & )
      fi
      ;;
  esac
fi
