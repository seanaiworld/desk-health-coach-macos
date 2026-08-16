#!/bin/bash
# Identity-safe resume after stop: refuses to load a plist that isn't provably this project's.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="$("$SCRIPT_DIR/agent.sh" label)"
PLIST="$("$SCRIPT_DIR/agent.sh" plist-path)"

if [ ! -f "$PLIST" ]; then
  echo "START_FAILED: no registered LaunchAgent for this project (expected label $LABEL) — run setup first" >&2
  exit 1
fi
if ! grep -qF "$SCRIPT_DIR/runner.sh" "$PLIST"; then
  echo "START_FAILED: $PLIST does not reference this project's runner.sh — refusing to load a mismatched identity" >&2
  exit 1
fi

"$SCRIPT_DIR/agent.sh" load
"$SCRIPT_DIR/agent.sh" status
