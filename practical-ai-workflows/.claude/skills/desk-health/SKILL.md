---
name: desk-health
description: Manage and coach this project's local macOS desk-health routine from its current settings and self-reported log summary.
---

# Desk Health Coach

A personal, local desk-health reminder-and-log system for this project, built once from the
Desk Health Coach build-instructions contract and reused unchanged for every viewer. The
runtime (`desk-health/runtime/*`) is a fixed, already-validated engine — nothing here
regenerates it. Only `desk-health/config/*.tsv` (settings, routine, library) is ever per-viewer.

## Invariant rules — apply on every route below

- **Non-medical.** This is behavior/habit coaching. Never diagnose, treat, measure a symptom, or
  claim a movement physically happened. Done/Skip are self-reports. `responseSec` is prompt-to-click
  time, never "seconds exercised."
- **No monitoring, ever.** No camera, screenshot, screen recording, microphone, keyboard/mouse, or
  presence detection — in this release or as a future add-on. Refuse a request to add one; say why.
- **macOS v1 only.** Fixed repeating workdays/hours, 24-hour time, same-day start<end. No Windows
  version, no variable shifts, no calendar access, no inferred meetings.
- **Approval before activation.** Every routine/settings change: show the affected row before/after,
  the full new timeline, the 8-minute scheduled-spacing + 5-minute actual-show + quiet-window
  checks, and wait for explicit approval before writing a command the runner will apply. Never
  change frequency just because priority or "busy" context suggests it.
- **Test mode is not evidence of a habit.** Only live-mode data may be discussed as if it reflects
  real behavior. Always label test-mode numbers as installation-test data.
- **Coaching reads `coach-summary.json` only, by default.** Never `summary.json`, `settings.tsv`,
  `routine.tsv`, or raw `log.jsonl`/`slots.jsonl` directly for a coaching answer — regenerate and
  read the whitelisted file (`runtime/report.sh <mode> coach-summary`). Read raw events only on an
  explicit drill-down request, and say so before doing it.
- **Collisions are never silently resolved by dropping a type or overriding a chosen cadence.**
  If `runtime/validate.sh` reports a scheduling collision, present the exact collision and
  pre-computed one-click resolution options in a single message — never negotiate row by row.
- **Never overwrite an existing live installation.** If `desk-health/config/settings.tsv` and
  `runtime/mode` already show a live install, this is an update, not a fresh setup — stop and say so.

## Routing

| Command | Route |
|---|---|
| `/desk-health` (no args), or first-ever use | [setup.md](setup.md) if no installation exists; otherwise the status view described in `edit.md` |
| `/desk-health list`, `on\|off`, `more\|less`, `add\|change`, `pause\|resume`, `start`, `stop`, `uninstall` | [edit.md](edit.md) |
| A request to change work hours/days, quiet windows, limitations, priority, coaching tone, goal, or gamification on/off | [edit.md](edit.md) ("Settings changes" section) |
| `/desk-health how am I doing`, or "how am I doing" in plain sentences | [coach.md](coach.md) |
| `/desk-health undo` | [edit.md](edit.md) |
| `/desk-health dashboard` | [edit.md](edit.md) |
| `/desk-health test status\|fire\|scenario` | [edit.md](edit.md) (Section 3 test-mode route) |
| A request to add/change a movement, or asking about a source/citation | [library.md](library.md) |
| A fresh Section 1 PDF attached (with or without the build-instructions file) | [setup.md](setup.md) |

Recognize both the literal `/desk-health ...` form and an equivalent plain sentence ("pause my
desk health reminders for 20 minutes", "turn off wrist reminders", "how am I doing on my desk
breaks").

## Where things live

`desk-health/config/*.tsv` (settings, routine, library, messages) — the only per-viewer files;
gitignored, since they hold schedule/limitation/goal data.
`desk-health/seed/library.tsv`, `desk-health/seed/messages.tsv` — tracked, viewer-agnostic source
copies of the built-in catalog and milestone-message set; `setup.md` copies these into a fresh
viewer's `config/` (which git never sees) rather than reading from another viewer's live config.
`desk-health/runtime/*` — the fixed engine (`runner.sh`/`dialog.js`/`report.sh`/`validate.sh` plus
`agent.sh`/`promote.sh`/`cutover.sh`/`stop.sh`/`start.sh`/`uninstall.sh`/`manifest.sh`/`testctl.sh`).
`desk-health/data/`, `desk-health/state/` — canonical logs/state; never hand-edited by Claude.
`desk-health/dashboard.html`, `desk-health/coach-summary.json` — regenerated on request only.
