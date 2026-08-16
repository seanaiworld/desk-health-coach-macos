#!/bin/bash
# Unloads the LaunchAgent but preserves every file and all history.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/agent.sh" unload
echo "STOPPED — runner unloaded; config, state, and data files are untouched."
