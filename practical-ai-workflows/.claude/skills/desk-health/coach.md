# coach.md — "how am I doing"

## 1. Regenerate and read only the whitelisted file

```
desk-health/runtime/report.sh <live|test> coach-summary
```

Read **only** the resulting `coach-summary.json` (root, or
`data/test-runs/.current/coach-summary.json` in test mode) for this answer. Never open
`data/summary.json`, `config/settings.tsv`, `config/routine.tsv`, or raw
`log.jsonl`/`slots.jsonl` for a coaching answer.

Validate every key before using it — reject and regenerate if anything is off-schema:

Top level, exactly: `schemaVersion, mode, generatedAt, sampleWindow, aggregateResults, schedule,
enabledRoutine, movementLimits, priorityArea, workSetting, busyContext, statedGoal,
coachingTone, gamification, recentChanges`.

- `schemaVersion` string; `mode` is `"test"` or `"live"`; `generatedAt` an ISO date-time string.
- `sampleWindow`: only `start, end, workdayCount`.
- `aggregateResults`: only `done, skipped, excluded, completionRate, byDay, byType,
  byTimeBucket, excludedByReason`. The three `by*` maps hold only numeric Done/Skip/excluded
  counts or rates per key; `excludedByReason` maps a reason string to an integer count.
- `schedule`: only `workdays, workStart, workEnd, quietWindows` (each window: `days, start, end`,
  optional `label`).
- `enabledRoutine` entries: only `type, mode, cadenceMinutes, times, enabled, optionId,
  priorityRank` (integer or null).
- `movementLimits`: string array. `priorityArea` is derived (the type of the rank-1 routine row,
  or null when nothing is ranked), never a stored setting. `priorityArea, workSetting, busyContext, statedGoal,
  coachingTone`: string or null.
- `gamification`: `{enabled:false}` or `{enabled:true, score, combo, streak}` — no other keys.
- `recentChanges` entries: only `timestamp, area, changeType, before, after` — `before`/`after`
  contain only the changed approved schedule/routine fields above, never a raw log line or event.

If `mode` is `"test"`, say so up front and label everything that follows as installation-test
data, not evidence of a changed habit — do not answer as if it reflects real behavior.

## 2. State only observable self-report facts

Sample size, Done/Skip counts, rates by type and time bucket (map hour-of-day buckets to
plain language — "around 2–3pm" beats "bucket 14"), excluded periods and their reasons, current
enabled/disabled settings, and recent approved edits (from `recentChanges`).

## 3. Separate fact from hypothesis

Never claim *why* the viewer skipped something — that's not observable from this data. If the
cause is unclear and matters to the answer, ask one short question instead of guessing.

## 4. Pattern or honest "not enough data yet"

If the sample genuinely supports a pattern (e.g. skip rate at a specific time bucket noticeably
higher than others, or `busyContext` from `schedule`/settings lining up with low completion at
that time), quote the specific numbers. If it doesn't, say there isn't enough data yet and
propose one small test to revisit later — never manufacture a trend from a handful of samples.

Offer exactly **one** concrete behavior adjustment or test tied to the evidence just shown. If it
implies a routine/settings change, show before, after, the full timeline, and the validation
result (route through `edit.md`'s propose→validate→approve flow) — wait for explicit approval
before writing any command. A coaching answer never changes live config on its own.

## 5. Never diagnose or claim causation

The optional `statedGoal` is a check-in question ("does this match how you've been feeling?"),
never something the log "proved." Never claim the routine caused or fixed a health outcome.

## Drill-down

Only on an explicit request ("show me the raw log", "why exactly did today's 2pm one get
excluded") may raw `log.jsonl`/`slots.jsonl` be read — tell the viewer first that this goes
beyond the regenerated summary, then read only what's needed to answer.
