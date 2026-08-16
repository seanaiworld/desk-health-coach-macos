# edit.md — status, routine edits, pause/resume, lifecycle, and Section 3 test commands

All shell invocations below assume cwd-independence: they're always run as
`desk-health/runtime/<script>` from the project root. Every routine/settings change follows
**propose → validate → approve → command → runner applies** — Claude never writes
`config/*.tsv`, `state/*`, or `data/*` directly once an installation is live or under test; only
`runtime/promote.sh` (fresh install) and the runner (via a command file) touch those.

## `/desk-health` / `/desk-health list`

Determine mode: `cat desk-health/runtime/mode` (or "no installation" if the file/tree is absent
→ route to `setup.md`). Then:

```
desk-health/runtime/agent.sh status                              # LOADED pid=... / NOT_LOADED
desk-health/runtime/testctl.sh status                             # only meaningful in test mode
desk-health/runtime/report.sh <live|test> both                    # regenerate dashboard + coach-summary
```

Report: active mode, alive/dead (from `agent.sh status`), last heartbeat (`lastTick`/`lastHeartbeatTs`
in the status JSON or `state/state.json`), current enabled routine (`config/routine.tsv`), the
next scheduled slot (derive from `routine.tsv` + `settings.tsv` — the same timeline
`validate.sh` prints), today's self-reported Done/Skip and excluded count (from
`data/summary.json`'s `byDay` for today, or the test-mode equivalent).

## `on|off <type>`, `more|less <type>`, `add|change <type>`

1. Load current `config/routine.tsv` + `config/library.tsv` (read-only, to build the proposal —
   never edit them in place).
2. Build the proposed new routine row(s) in memory. For `add`/`change` referencing a movement
   outside the eighteen-item default catalog, route through `library.md`'s sourcing-and-approval
   flow first.
3. Write the candidate full routine to a scratch copy and run
   `desk-health/runtime/validate.sh <live|test>` is NOT for candidates — instead reuse the
   staging schema/collision logic by writing the candidate into `desk-health/.staging/config/`
   (routine.tsv + a copy of the current settings.tsv) and run `validate.sh staging`. This is the
   same exhaustive phase-search used at install; never hand-wave a phase.
4. Show the affected row before/after, the complete new timeline, the 8-minute/5-minute/quiet
   checks, and wait for explicit approval. Never change frequency just because priority or a
   "busy" context note suggests it.
5. On approval, write one command file (mode-600, atomic temp-then-rename) into
   `desk-health/state/commands/` (live) or `desk-health/data/test-runs/.current/state/commands/`
   (test):
   ```json
   {"requestId": "<uuid>", "mode": "live", "expectedRevision": <current settings.revision>,
    "type": "routine-edit",
    "payload": {"newRoutine": [...full routine array...], "changeType": "enable|disable|cadence|add-movement|remove-movement",
                "beforeRow": {...}, "afterRow": {...}}}
   ```
   The running `runner.sh` (via `tick.js`) picks this up on its next ~60s heartbeat, validates
   `expectedRevision`, applies it, bumps the revision, and appends `data/changes.jsonl`. Do not
   poll faster than that; tell the viewer the change takes effect on the next heartbeat.
6. Confirm by re-reading `config/routine.tsv` after the next heartbeat and showing the applied
   result.

Adding/removing a rotation movement within an existing category uses this exact same flow —
it's a `routine-edit` command with the row's `optionId` changed to add/drop a comma-separated
entry.

## Settings changes (work hours, workdays, quiet windows, limitations, tone, goal, gamification)

Anything that lives in `settings.tsv` rather than `routine.tsv` — work hours/days, quiet windows,
movement limitations, what's within reach, movement capacity, coaching tone,
milestone celebration on/off, gamification on/off, stated goal — changes through the identical
propose → validate → approve → command flow, not a special case. Recognize plain-language
requests too ("근무시간 8시로 바꿔줘", "add a quiet window for my daily standup", "turn off
gamification").

1. Load current `config/settings.tsv` (read-only). Build the candidate in memory.
2. Write the candidate into `desk-health/.staging/config/settings.tsv` alongside a copy of the
   *current* `routine.tsv`, and run `validate.sh staging`. Always re-run this even for a
   cosmetic-looking field (tone, goal) — it's cheap, and it's the one thing standing between a
   viewer and a work-hours change that silently breaks the 8-minute spacing on the existing
   routine. If `workdays`/`workStart`/`workEnd`/quiet windows changed, this re-derives the whole
   timeline exactly like a fresh install would.
3. If `limitations`/`withinReach`/`movementCapacity` changed, additionally check every
   *currently enabled* routine row's movement — including every `optionId` in a rotation list —
   against the library's `restrictions` field for the
   new constraints. Never silently leave a now-conflicting movement enabled — flag it and ask
   whether to disable or replace it, same as `on|off <type>` above.

**Priority is not a settings change.** It is the `priorityRank` column in `routine.tsv`, so
changing it is a `routine-edit` and must re-check the duplicate-rank rule (each rank used at most
once; blank = unranked). Changing a rank never changes a cadence — it only re-runs placement.
4. Show before/after for the changed fields, the full timeline if it changed, and wait for
   explicit approval. Never infer a settings change from a "busy" mention alone.
5. On approval, write one command file the same way as a routine edit:
   ```json
   {"requestId": "<uuid>", "mode": "live", "expectedRevision": <current settings.revision>,
    "type": "settings-edit",
    "payload": {"newSettings": {...only the changed keys...}, "changeType": "work-hours|quiet-window|limitations|tone|goal|gamification",
                "beforeFields": {...changed keys only...}, "afterFields": {...changed keys only...}}}
   ```
   `newSettings` only needs the keys that changed — the runner merges it onto the existing
   settings object, it does not replace the whole file.
6. Confirm by re-reading `config/settings.tsv` after the next heartbeat.

`undo` (below) works identically for a settings change as for a routine change — the runner
keeps a one-step snapshot of whichever kind of change was approved most recently and restores
that on `/desk-health undo`.

## `pause|resume`

`pause until <HH:MM>` / `pause for <duration>` / `resume` — never look up a time in a calendar;
if an end time is ambiguous, ask. Write a command file:
```json
{"requestId":"<uuid>","mode":"live","expectedRevision":<rev>,"type":"pause","payload":{"untilTs":"<local ISO>"}}
```
or `{"type":"resume","payload":{}}`. Pause is state, not a routine edit — it never touches
`routine.tsv`.

## `undo`

Write a command file `{"type":"undo","payload":{}}`. The runner keeps a one-step snapshot of
whichever kind of change — routine or settings — was approved most recently, restores that file
(`routine.tsv` or `settings.tsv`), and appends `data/changes.jsonl`. It only ever undoes the
single most recent approved change, whichever kind it was; there is no multi-step history. After
the next heartbeat, confirm the affected file (or the test copy) matches the pre-edit version
exactly.

## `dashboard`

```
desk-health/runtime/report.sh <live|test> dashboard
open desk-health/dashboard.html     # only if the viewer wants it opened; otherwise just confirm it was written
```
It's a local file, no server. It already stamps "as of <local time>" and labels data honestly as
self-reported.

## `stop` / `start`

```
desk-health/runtime/stop.sh     # unloads the agent, preserves every file
desk-health/runtime/start.sh    # identity-safe reload; refuses a mismatched label/path on purpose
```

## `uninstall`

Always dry-run first, always show the viewer the output, always wait for explicit confirmation
before ever running execute:
```
desk-health/runtime/uninstall.sh dry-run
# ... viewer confirms ...
desk-health/runtime/uninstall.sh execute
```
`execute` snapshots `settings.tsv`/`routine.tsv`/`library.tsv`/`changes.jsonl` into a timestamped
`data/uninstall-snapshot/`, stops the agent, and removes only the exact manifest-listed
runtime/config/dashboard/plist/skill files — `data/` and its history are preserved by default.

## Section 3 test-mode commands

Refuse all of these unless `runtime/mode` reads `test` and `data/test-runs/.current/` exists.

```
desk-health/runtime/testctl.sh status
desk-health/runtime/testctl.sh fire <type>
desk-health/runtime/testctl.sh scenario <pause|quiet|dialog-busy|unshown|wake-gap|collision|streak>
```

`fire` shows a real dialog (background-spawned, non-blocking) — walk the viewer through clicking
Done before `minSeconds` (expect "Not so fast", then a truthful later Done), and a separate fire
where they click Skip. Each scenario prints `{"ok":true/false, "detail": {...}}` — `detail`
contains the actual canonical record `evaluateSlot`/`settleSlot` produced (or, for `collision`,
the exact resolved-or-not report), which is the proof to show the viewer — never hand-write what
the outcome "should" be.

When every applicable Section 3 box has been walked through and the viewer confirms it, and only
then:
```
desk-health/runtime/agent.sh unload
desk-health/runtime/cutover.sh          # archives .current, zeroes live data, mode -> live
desk-health/runtime/agent.sh load
```
`cutover.sh` itself refuses to run if the agent is still loaded or if the test command/dialog
inbox or lock is non-empty — that's the mechanical enforcement of "the runner must never execute
in live mode before Section 3 is complete."
