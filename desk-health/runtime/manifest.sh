#!/bin/bash
# Regenerates desk-health/installed-files.txt: the exact, canonical-absolute-path list used by
# stop/uninstall. Only ever lists entries that actually exist under the desk-health folder, the
# one registered plist, or the project-root skill folder — never a glob of "whatever's there".
set -u
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BASE_DIR/.." && pwd)"
SKILL_DIR="$PROJECT_ROOT/.claude/skills/desk-health"
PLIST="$("$SCRIPT_DIR/agent.sh" plist-path)"

TMP="$BASE_DIR/installed-files.txt.tmp.$$"
: > "$TMP"

add() { [ -e "$1" ] && printf '%s\n' "$1" >> "$TMP"; }

add "$BASE_DIR/config/settings.tsv"
add "$BASE_DIR/config/routine.tsv"
add "$BASE_DIR/config/library.tsv"
add "$BASE_DIR/config/messages.tsv"
add "$BASE_DIR/runtime/runner.sh"
add "$BASE_DIR/runtime/dialog.js"
add "$BASE_DIR/runtime/report.sh"
add "$BASE_DIR/runtime/report.js"
add "$BASE_DIR/runtime/validate.sh"
add "$BASE_DIR/runtime/validate.js"
add "$BASE_DIR/runtime/lib.js"
add "$BASE_DIR/runtime/tick.js"
add "$BASE_DIR/runtime/testctl.js"
add "$BASE_DIR/runtime/testctl.sh"
add "$BASE_DIR/runtime/agent.sh"
add "$BASE_DIR/runtime/promote.sh"
add "$BASE_DIR/runtime/cutover.sh"
add "$BASE_DIR/runtime/stop.sh"
add "$BASE_DIR/runtime/start.sh"
add "$BASE_DIR/runtime/uninstall.sh"
add "$BASE_DIR/runtime/manifest.sh"
add "$BASE_DIR/runtime/mode"
add "$BASE_DIR/dashboard.html"
add "$BASE_DIR/coach-summary.json"
add "$PLIST"
# Skill docs are only ever this installation's when the engine sits one level inside a project
# folder. Unpacked directly at $HOME, PROJECT_ROOT becomes $HOME and SKILL_DIR resolves to the
# viewer's GLOBAL ~/.claude/skills/desk-health, which this copy never installed. Listing it would
# hand uninstall.sh a path it is allowed to delete, so refuse to claim it at all.
if [ "$PROJECT_ROOT" = "$HOME" ]; then
  echo "manifest: PROJECT_ROOT is \$HOME — skipping skill-doc entries (would claim the global ~/.claude/skills/desk-health)" >&2
else
  add "$SKILL_DIR/SKILL.md"
  add "$SKILL_DIR/setup.md"
  add "$SKILL_DIR/edit.md"
  add "$SKILL_DIR/coach.md"
  add "$SKILL_DIR/library.md"
fi

mv "$TMP" "$BASE_DIR/installed-files.txt"
chmod 600 "$BASE_DIR/installed-files.txt"
cat "$BASE_DIR/installed-files.txt"
