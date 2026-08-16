#!/bin/bash
# Promotes an already-validated desk-health/.staging/config into the live config location for
# a FRESH install only, initializes the isolated test copy, and sets runtime/mode=test. Refuses
# if a live installation already exists (that needs the separate update/migration path).
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "PROMOTE_FAILED: $1" >&2; exit 1; }

for f in "$BASE_DIR/config/settings.tsv" "$BASE_DIR/config/routine.tsv" "$BASE_DIR/config/library.tsv" \
         "$BASE_DIR/state/state.json" "$BASE_DIR/data/slots.jsonl" "$BASE_DIR/data/log.jsonl" \
         "$BASE_DIR/data/summary.json"; do
  [ -e "$f" ] && fail "existing live file found ($f) — this is not a fresh install. If this copy was unpacked from an archive, that file belongs to whoever made it: clear the carried-over config/, .staging/config/, and data/test-runs/.current/, then start from setup.md 0.1. If it is your own install, do not promote — edit it via edit.md."
done

for f in "$BASE_DIR/.staging/config/settings.tsv" "$BASE_DIR/.staging/config/routine.tsv" "$BASE_DIR/.staging/config/library.tsv"; do
  [ -f "$f" ] || fail "missing staged file: $f"
done

mkdir -p "$BASE_DIR/config" "$BASE_DIR/state/inbox" "$BASE_DIR/state/commands" "$BASE_DIR/data/inbox" "$BASE_DIR/data/test-runs" "$BASE_DIR/runtime"
chmod 700 "$BASE_DIR/config" "$BASE_DIR/state" "$BASE_DIR/state/inbox" "$BASE_DIR/state/commands" "$BASE_DIR/data" "$BASE_DIR/data/test-runs"

cp "$BASE_DIR/.staging/config/settings.tsv" "$BASE_DIR/config/settings.tsv"
cp "$BASE_DIR/.staging/config/routine.tsv" "$BASE_DIR/config/routine.tsv"
cp "$BASE_DIR/.staging/config/library.tsv" "$BASE_DIR/config/library.tsv"
[ -f "$BASE_DIR/.staging/config/messages.tsv" ] && cp "$BASE_DIR/.staging/config/messages.tsv" "$BASE_DIR/config/messages.tsv"
chmod 600 "$BASE_DIR"/config/*.tsv

REPORT="$("$SCRIPT_DIR/validate.sh" live)"
echo "$REPORT"
case "$REPORT" in
  '{"ok":true'*) : ;;
  *) rm -rf "$BASE_DIR/config"; fail "promoted baseline failed validate.sh live — staging left untouched, live config removed" ;;
esac

CURRENT="$BASE_DIR/data/test-runs/.current"
mkdir -p "$CURRENT/config" "$CURRENT/state/inbox" "$CURRENT/state/commands" "$CURRENT/data" "$CURRENT/quarantine"
chmod 700 "$CURRENT" "$CURRENT/config" "$CURRENT/state" "$CURRENT/state/inbox" "$CURRENT/state/commands" "$CURRENT/data" "$CURRENT/quarantine"
cp "$BASE_DIR/config/settings.tsv" "$CURRENT/config/settings.tsv"
cp "$BASE_DIR/config/routine.tsv" "$CURRENT/config/routine.tsv"
cp "$BASE_DIR/config/library.tsv" "$CURRENT/config/library.tsv"
[ -f "$BASE_DIR/config/messages.tsv" ] && cp "$BASE_DIR/config/messages.tsv" "$CURRENT/config/messages.tsv"
chmod 600 "$CURRENT"/config/*.tsv
: > "$CURRENT/data/changes.jsonl"
chmod 600 "$CURRENT/data/changes.jsonl"

printf 'test' > "$BASE_DIR/runtime/mode"
chmod 600 "$BASE_DIR/runtime/mode"

echo "PROMOTE_OK test-copy=$CURRENT"
