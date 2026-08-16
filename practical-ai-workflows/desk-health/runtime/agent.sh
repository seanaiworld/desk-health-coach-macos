#!/bin/bash
# Desk Health Coach — per-user LaunchAgent management.
# Usage: agent.sh label|write-plist|load|unload|status
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BASE_DIR/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"

# Verified label-slug one-liner from the build contract, sourced from the resolved project
# root's basename (not raw $PWD) so this is correct regardless of the caller's cwd.
LABEL="com.deskhealth.$(printf '%s' "$PROJECT_NAME" | tr -cs 'a-zA-Z0-9' '-' | tr 'A-Z' 'a-z')"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_N="$(id -u)"

CMD="${1:?usage: agent.sh label|write-plist|load|unload|status}"

case "$CMD" in
  label)
    echo "$LABEL"
    ;;

  plist-path)
    echo "$PLIST"
    ;;

  write-plist)
    if [ -f "$PLIST" ]; then
      echo "EXISTS $PLIST"
      exit 3
    fi
    umask 077
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>${SCRIPT_DIR}/runner.sh</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${SCRIPT_DIR}/launchd.out.log</string>
	<key>StandardErrorPath</key>
	<string>${SCRIPT_DIR}/launchd.err.log</string>
</dict>
</plist>
PLISTEOF
    chmod 600 "$PLIST"
    echo "$PLIST"
    ;;

  load)
    launchctl bootstrap "gui/${UID_N}" "$PLIST" 2>&1
    ;;

  unload)
    launchctl bootout "gui/${UID_N}/${LABEL}" 2>&1
    # bootout returns before the domain fully settles; block briefly so a caller that
    # immediately checks status (or reloads) sees the real post-unload state, not a stale read.
    for i in 1 2 3 4 5 6 7 8 9 10; do
      launchctl print "gui/${UID_N}/${LABEL}" >/dev/null 2>&1 || break
      sleep 0.3
    done
    exit 0
    ;;

  status)
    STATUS_OUT="$(launchctl print "gui/${UID_N}/${LABEL}" 2>&1)"
    if [ $? -eq 0 ]; then
      PID="$(printf '%s\n' "$STATUS_OUT" | grep -m1 -E '^[[:space:]]*pid = ' | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
      echo "LOADED pid=${PID:-none} label=${LABEL}"
      exit 0
    else
      echo "NOT_LOADED label=${LABEL}"
      exit 1
    fi
    ;;

  *)
    echo "unknown agent.sh command: $CMD" >&2
    exit 1
    ;;
esac
