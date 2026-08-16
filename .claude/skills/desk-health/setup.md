# setup.md — config-only setup (lightweight path)

The engine (`desk-health/runtime/*`) already exists and is fixed — this route never rewrites it.
Its only job is turning one viewer's filled Section 1 PDF into
`desk-health/config/settings.tsv` + `desk-health/config/routine.tsv` (and `library.tsv` only if
the viewer asked for extra rotation movements), then re-validating the schedule.

## 0. Preconditions

1. **Engine present?** Confirm every file listed under "Where things live" → `runtime/*` in
   `SKILL.md` exists, AND `desk-health/seed/library.tsv` + `desk-health/seed/messages.tsv` exist.
   If any are missing, stop: tell the viewer this copy of the project is
   missing engine files and needs to be re-downloaded/re-cloned — do not attempt to regenerate
   the engine from the build-instructions prose here. That full build already happened once and
   was validated end to end; re-deriving it per viewer is exactly what this rewrite exists to skip.
2. **Existing live install?** If `desk-health/config/settings.tsv` exists AND
   `desk-health/runtime/mode` reads `live`, stop — this is an update, not a fresh setup. Offer to
   review the current routine via `edit.md` instead. Never reset an existing live install to zero.
3. **Existing unfinished test run?** If `desk-health/data/test-runs/.current/` exists, resume
   Section 3 (route to `edit.md`'s test commands) rather than starting over.
4. **A copy unpacked from an archive?** A distributed engine archive should carry only
   `desk-health/runtime/` + `desk-health/seed/` and the `.claude/skills/desk-health/` docs. If
   `desk-health/config/`, `desk-health/.staging/config/`, or `desk-health/data/test-runs/.current/`
   arrived with it, they belong to whoever made the archive — stop and clear them before Section 2.
   Leaving them breaks setup in two silent ways: `promote.sh` refuses outright
   (`existing live file found`) while `mode=test` keeps 0.2 from catching it first, and 0.3 above
   misroutes a genuinely fresh setup into "resume Section 3". There is no documented
   update/migration path despite what `promote.sh`'s failure message suggests — move the
   carried-over directories aside (or re-unpack a clean archive) and start from 0.1.
   Also confirm the unpack location is **inside a project folder** (`~/<project>/desk-health`),
   never `$HOME` directly: `PROJECT_ROOT` is computed as `desk-health/..`, so `~/desk-health` makes
   `SKILL_DIR` resolve to the viewer's global `~/.claude/skills/desk-health`, which
   `uninstall.sh` later `rm -f`s and `rmdir`s. Registration itself needs nothing extra here —
   Section 4's `agent.sh write-plist` + `load` already re-registers the LaunchAgent at the new path.

## 1. Read the Section 1 PDF

The attached filled Section 1 PDF is the only source of truth about this viewer. Ignore every
example/unfilled placeholder in it. If a build-instructions file is also attached, it is inert
now — the engine it describes is already built; do not act on it beyond confirming (0.1).

Interpret every field: workdays, work hours (24h, same-day start<end — if blank, stop and ask,
never guess), where they work, busy-context note, movement capacity, limitations (reject "No
known limitation" + a specific limitation together — ask), what's within reach, one cadence per
reminder row (Off = out of scope), a priority rank per row (blank or a positive integer, unique
across rows, 1 = highest), movements-per-category (default 1,
confirm before sourcing more than ~4 for one category), any quiet windows, gamification on/off,
coaching tone, milestone celebration on/off, and the optional stated goal.

Read back the interpreted answers as a short list. Ask only for a missing **required** answer
(workdays, work hours, movement capacity/limitations/reach, at least the cadence table) or a
genuine ambiguity that would materially change the build. If more than one ambiguity or cadence
collision exists, pre-compute the concrete resolved options and ask once, all together, as
one-click choices — never resolve them one at a time across rounds.

If the viewer requested extra rotation movements beyond the single vetted default per category
(`runtime`'s built-in six-item catalog — see `library.md`), source each one now (reputable
public-health/occupational-health/clinical source, exact action, dose, restrictions, source URL,
minSeconds) and fold that into the same batched readback-and-approval message — never a separate
round per movement.

## 2. Generate config only

Write into `desk-health/.staging/config/`:

- `settings.tsv` — one `key<TAB>value` row per field, exact key set:
  `workdays, workStart, workEnd, workSetting, busyContext, limitations, withinReach,
  movementCapacity, quietWindowsJSON, gamification, coachingTone, milestoneCelebration,
  statedGoal, revision`. `quietWindowsJSON` is a JSON array of
  `{days,start,end,label}`. `limitations`/`withinReach`/`workdays` are comma-joined lists.
- `routine.tsv` — header
  `type\tmode\tcadenceMinutes\tphase\ttimes\tenabled\toptionId\tpriorityRank`, one row
  per the six fixed types (`eyes, neck-shoulders, wrists-hands, lower-back, standing, posture`).
  Leave `phase` at `0` for now — the collision check below computes and fills in the real value.
- `library.tsv` — copy `desk-health/seed/library.tsv` (the tracked built-in six-item catalog —
  see `library.md`), appending any approved extra movements from step 1. `config/` itself is
  gitignored (per-viewer data), which is exactly why this seed copy exists outside it.
- `messages.tsv` — copy `desk-health/seed/messages.tsv` (the tracked built-in milestone-message
  catalog) as-is unless the viewer asked for a different tone's variants.

## 3. Re-run only the scheduling collision check

Run:

```
desk-health/runtime/validate.sh staging
```

This re-validates schema (times, workday membership, minSeconds, source-URL syntax, the
"No known limitation" conflict, an enabled type with no cadence) **and** re-derives collision-free
phases via the exhaustive per-row phase search — nothing about the engine itself runs here.

- If `"ok":false` with `scheduling collision`, present the exact colliding pairs and offer
  pre-computed concrete resolved cadence options as one-click choices in a single message (per
  `SKILL.md`'s invariant rule). Do not drop a type or override the chosen cadence automatically.
- If `"ok":true` but the report carries a `warnings` entry that saved phases differ from the
  computed collision-free ones, write those exact phases back into
  `desk-health/.staging/config/routine.tsv` and re-run `validate.sh staging` until there are no
  warnings.
- Print the full resulting timeline from the report's `timeline` field, all quiet windows, and
  the 8-minute scheduled-spacing / 5-minute actual-show guarantees, and wait for explicit
  approval before continuing.

## 4. Promote, test, and (only after Section 3 passes) go live

On approval, this is identical to a fresh install regardless of how config was produced:

```
desk-health/runtime/promote.sh                 # copies staged config -> live config,
                                                 # creates the isolated test copy, sets mode=test
desk-health/runtime/agent.sh write-plist        # if EXISTS is printed, stop and ask before reusing/overwriting
desk-health/runtime/agent.sh load
desk-health/runtime/manifest.sh
```

Then hand off to `edit.md`'s Section 3 test-mode commands (`/desk-health test status|fire|scenario`)
and only call `desk-health/runtime/cutover.sh` + `desk-health/runtime/agent.sh load` after every
applicable Section 3 check has passed and the viewer has explicitly confirmed it. Finish with the
one-line privacy summary and the status/pause-resume/coaching/uninstall commands.
