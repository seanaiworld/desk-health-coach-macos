#!/bin/bash
# Usage: validate.sh <staging|live|test>
# Prints a JSON report {ok, errors, warnings, timeline} and exits 0 if ok, 1 otherwise.
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:?usage: validate.sh <staging|live|test>}"
REPORT="$(osascript -l JavaScript -e "$(cat "$SCRIPT_DIR/lib.js")" -e "$(cat "$SCRIPT_DIR/validate.js")" -- "$BASE_DIR" "$TARGET")"
echo "$REPORT"
# validate.js always emits {"ok":<bool>,... as the first key — no extra runtime (jq/python)
# needed just to read one leading boolean back out.
case "$REPORT" in
  '{"ok":true'*) exit 0 ;;
  *) exit 1 ;;
esac
