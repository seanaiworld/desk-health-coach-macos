# Desk Health Coach (macOS)

A personal, local desk-health reminder-and-log system you run on your own Mac with Claude Code.
It reminds you to move — eyes, neck/shoulders, wrists/hands, lower back, standing, posture — on a
schedule built around *your* workdays, hours, limitations, and quiet windows, then lets you ask how
you're actually doing.

Everything runs locally. Nothing is uploaded anywhere.

## What it is not

- **Not monitoring.** No camera, screenshot, screen recording, microphone, keyboard/mouse capture,
  or presence detection — not in this release, and not as a future add-on.
- **Not medical.** This is behavior/habit coaching. It never diagnoses, treats, or measures a
  symptom. Done/Skip are your own self-reports, and the coach treats them that way.
- **macOS only.** Fixed repeating workdays and hours, 24-hour time, same-day start &lt; end.

## Requirements

- macOS (uses `launchd` + AppleScript dialogs)
- [Claude Code](https://claude.com/claude-code)
- Your filled **Section 1** questionnaire (the free resource from the video) — the setup route reads
  it to build your schedule

## Getting started

```bash
git clone https://github.com/seanaiworld/desk-health-coach-macos.git
cd desk-health-coach-macos/practical-ai-workflows
claude
```

Then attach your filled Section 1 file and run:

```
/desk-health
```

Claude reads your answers, generates your config, runs the scheduling collision check, and shows you
the full timeline for approval before anything is installed. It installs in **test mode** first —
you verify the reminders actually fire the way you want, and only then does it go live.

## Folder layout — keep it as-is

```
desk-health-coach-macos/
└── practical-ai-workflows/     ← open THIS folder in Claude Code
    ├── .claude/skills/desk-health/   the skill (setup, edit, coach, library)
    ├── .agents/skills/desk-health    same skill, for Codex
    └── desk-health/
        ├── runtime/                  the fixed engine — never edit
        └── seed/                     built-in movement + message catalogs
```

Don't move `desk-health/` up to your home folder or flatten the `practical-ai-workflows/` wrapper.
The runtime computes its project root as `desk-health/..`, so `desk-health/` must always sit inside a
project folder. Placing it directly in `~` makes `uninstall.sh` target your *global*
`~/.claude/skills/desk-health` instead of this project's copy.

Your generated `config/`, `data/`, and `state/` are gitignored — your schedule, limitations, goal,
and logs never get committed.

## Commands

| Command | What it does |
|---|---|
| `/desk-health` | Status: current routine, timeline, mode |
| `/desk-health list` | All reminder types and their cadences |
| `/desk-health on\|off` | Turn a reminder type on or off |
| `/desk-health more\|less` | Make a type more or less frequent |
| `/desk-health add\|change` | Add or change a movement |
| `/desk-health pause\|resume` | Pause reminders for a while, then resume |
| `/desk-health how am I doing` | Coaching read on your logged behavior |
| `/desk-health dashboard` | Regenerate and open the local dashboard |
| `/desk-health undo` | Revert the last approved change |
| `/desk-health start\|stop` | Start or stop the background agent |
| `/desk-health uninstall` | Remove the LaunchAgent and installed files |

Every change to your routine is shown to you — the affected row before/after, the new timeline, and
the spacing/quiet-window checks — and waits for your explicit approval before it's applied.

Plain sentences work too: "pause my desk health reminders for 20 minutes", "turn off wrist
reminders", "how am I doing on my desk breaks".

---

Built for the **Sean | Practical AI Workflows** YouTube channel.
