#!/bin/bash
# Usage: report.sh <live|test> [dashboard|coach-summary|both]
# Regenerates dashboard.html and/or coach-summary.json for the given mode. Only runs on request.
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:?usage: report.sh <live|test> [dashboard|coach-summary|both]}"
WHAT="${2:-both}"
osascript -l JavaScript -e "$(cat "$SCRIPT_DIR/lib.js")" -e "$(cat "$SCRIPT_DIR/report.js")" -- "$BASE_DIR" "$MODE" "$WHAT"
