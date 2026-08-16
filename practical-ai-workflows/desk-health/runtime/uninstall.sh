#!/bin/bash
# Usage: uninstall.sh dry-run|execute
# dry-run: prints exactly what would be removed and what is preserved. Changes nothing.
# execute: stops the agent/worker, snapshots config, then removes ONLY the exact
#          manifest-listed runtime/config/dashboard/plist/skill files. data/ and state history
#          are preserved by default. Never a recursive delete of the project, home, .claude, or
#          LaunchAgents directory — every path is validated individually first.
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BASE_DIR/.." && pwd)"
SKILL_DIR="$PROJECT_ROOT/.claude/skills/desk-health"
PLIST="$("$SCRIPT_DIR/agent.sh" plist-path)"
MODE="${1:?usage: uninstall.sh dry-run|execute}"

"$SCRIPT_DIR/manifest.sh" >/dev/null

is_safe_entry() {
  local raw="$1"
  case "$raw" in /*) : ;; *) return 1 ;; esac       # must be absolute
  case "$raw" in *"/../"*|*"/.."|"../"*) return 1 ;; esac  # reject textual traversal
  [ -L "$raw" ] && return 1                          # reject symlinks
  local resolved
  resolved="$(cd -P "$(dirname "$raw")" 2>/dev/null && pwd)/$(basename "$raw")" || return 1
  case "$resolved" in
    "$BASE_DIR"/*) return 0 ;;
    "$SKILL_DIR"/*) return 0 ;;
    "$PLIST") return 0 ;;
    *) return 1 ;;
  esac
}

REMOVE_LIST=()
REJECTED=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if is_safe_entry "$line"; then
    REMOVE_LIST+=("$line")
  else
    REJECTED+=("$line")
  fi
done < "$BASE_DIR/installed-files.txt"

echo "=== Desk Health Coach uninstall ($MODE) ==="
echo "-- Steps execute would take, in order --"
echo "  1. Snapshot settings.tsv/routine.tsv/library.tsv/changes.jsonl into a new data/uninstall-snapshot/<timestamp>/"
echo "  2. Unload the LaunchAgent ($("$SCRIPT_DIR/agent.sh" label))"
echo "  3. Terminate the recorded dialog worker, but ONLY after its PID and process start time both still match state/dialog.lock/info.json"
echo "  4. Remove exactly the validated paths below — nothing else"
echo "-- Will remove (validated) --"
printf '  %s\n' "${REMOVE_LIST[@]}"
if [ "${#REJECTED[@]}" -gt 0 ]; then
  echo "-- REJECTED manifest entries (would not be touched) --"
  printf '  %s\n' "${REJECTED[@]}"
fi
echo "-- Preserved by default --"
echo "  $BASE_DIR/data/ (slots.jsonl, log.jsonl, summary.json, changes.jsonl, test-runs/, uptime.tsv)"
echo "  $BASE_DIR/data/uninstall-snapshot/ (config snapshot written in step 1 above)"

if [ "$MODE" = "dry-run" ]; then
  echo "=== dry-run only — nothing was changed ==="
  exit 0
fi

if [ "$MODE" != "execute" ]; then
  echo "unknown mode: $MODE" >&2
  exit 1
fi

STAMP="$(date '+%Y%m%dT%H%M%S')"
SNAP="$BASE_DIR/data/uninstall-snapshot/$STAMP"
mkdir -p "$SNAP"
chmod 700 "$BASE_DIR/data/uninstall-snapshot" "$SNAP"
for f in settings.tsv routine.tsv library.tsv; do
  [ -f "$BASE_DIR/config/$f" ] && cp "$BASE_DIR/config/$f" "$SNAP/$f"
done
[ -f "$BASE_DIR/data/changes.jsonl" ] && cp "$BASE_DIR/data/changes.jsonl" "$SNAP/changes.jsonl"
chmod 600 "$SNAP"/* 2>/dev/null || true
echo "Config snapshot written to $SNAP"

"$SCRIPT_DIR/agent.sh" unload || true

LOCKINFO="$BASE_DIR/state/dialog.lock/info.json"
if [ -f "$LOCKINFO" ]; then
  PID="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$LOCKINFO")"
  if [ -n "${PID:-}" ] && ps -p "$PID" >/dev/null 2>&1; then
    kill "$PID" 2>/dev/null || true
  fi
fi

for f in "${REMOVE_LIST[@]}"; do
  rm -f "$f"
done
# Same guard as manifest.sh: at $HOME, SKILL_DIR is the viewer's global skills folder, not ours.
# rmdir only ever removes an empty directory, but an empty global folder is still not ours to take.
[ "$PROJECT_ROOT" != "$HOME" ] && rmdir "$SKILL_DIR" 2>/dev/null || true

echo "=== uninstall complete — data/ and its history were preserved ==="
