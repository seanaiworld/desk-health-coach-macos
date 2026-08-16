#!/bin/bash
# Archives the isolated test run and switches this installation to live mode with everything
# starting at zero. Only ever run after every applicable Section 3 check has passed. Refuses to
# run while the LaunchAgent or a dialog worker is still active, or while the test command/dialog
# inbox or lock is non-empty — those are exactly the invariants the build contract requires.
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CURRENT="$BASE_DIR/data/test-runs/.current"

fail() { echo "CUTOVER_FAILED: $1" >&2; exit 1; }

if "$SCRIPT_DIR/agent.sh" status >/dev/null 2>&1; then
  fail "LaunchAgent is still loaded — stop it first (agent.sh unload) and confirm no dialog worker is running"
fi
[ -d "$CURRENT" ] || fail "no active test run at $CURRENT"

for d in "$CURRENT/state/commands" "$CURRENT/state/inbox"; do
  if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
    fail "$d is not empty — drain it before cutover"
  fi
done
[ -d "$CURRENT/state/dialog.lock" ] && fail "test dialog lock is still held — resolve it before cutover"

STAMP="$(date '+%Y%m%dT%H%M%S')"
ARCHIVE="$BASE_DIR/data/test-runs/$STAMP"
mv "$CURRENT" "$ARCHIVE"
echo "ARCHIVED test run -> $ARCHIVE"

mkdir -p "$BASE_DIR/state/inbox" "$BASE_DIR/state/commands" "$BASE_DIR/data/inbox"
chmod 700 "$BASE_DIR/state" "$BASE_DIR/state/inbox" "$BASE_DIR/state/commands" "$BASE_DIR/data"

: > "$BASE_DIR/data/slots.jsonl"
: > "$BASE_DIR/data/log.jsonl"
printf '{"byDay":{},"byType":{},"byTimeBucket":{},"excludedByReason":{},"score":0,"combo":0,"comboDay":null,"streak":0,"lastStreakDay":null,"totals":{"done":0,"skipped":0,"excluded":0}}' > "$BASE_DIR/data/summary.json"
printf '{"ts":"%s","area":"setup","changeType":"setup-baseline","before":null,"after":null}\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$BASE_DIR/data/changes.jsonl"
printf '{"configRevision":1,"currentDay":null,"pauseUntil":null,"lastTick":null,"shownSlots":{},"settledSlots":{},"activeDialog":null,"rotationState":{},"appliedCommands":{},"lastHeartbeatTs":null,"lastMilestoneLine":{}}' > "$BASE_DIR/state/state.json"
chmod 600 "$BASE_DIR/data/slots.jsonl" "$BASE_DIR/data/log.jsonl" "$BASE_DIR/data/summary.json" "$BASE_DIR/data/changes.jsonl" "$BASE_DIR/state/state.json"

printf 'live' > "$BASE_DIR/runtime/mode"
chmod 600 "$BASE_DIR/runtime/mode"

"$SCRIPT_DIR/report.sh" live both

echo "CUTOVER_OK mode=live archive=$ARCHIVE"
echo "Next: agent.sh load  (this is the explicit step that starts real reminders on the approved schedule)"
