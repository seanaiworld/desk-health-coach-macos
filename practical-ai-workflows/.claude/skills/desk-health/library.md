# library.md — the movement catalog

## Built-in defaults (never invent an alternative to these; use as-is)

| optionId | type | action | dose | minSeconds | restrictions |
|---|---|---|---|---|---|
| `distance-gaze-20s` | eyes | Look at something ~20 feet away for 20 seconds | 20 sec | 20 | — |
| `shoulder-rolls` | neck-shoulders | Gently roll shoulders 3x forward, 3x back | 6 rolls | 15 | — |
| `hands-open-close` | wrists-hands | Make a fist, then open and spread fingers, x3 | 3 reps | 10 | — |
| `seated-slouch-tall` | lower-back | Seated: gently slouch, then sit tall, x3 | 3 reps | 15 | omit for back pain/limits or uncertainty |
| `stand-walk` | standing | Stand and walk near the desk for 60 seconds | 60 sec | 60 | standing/walking must be allowed |
| `posture-self-check` | posture | Check head/neck, shoulders, wrists, lower back, feet | one check | 15 | — |

Full instructions/Why/sourceURL for each live in the tracked seed file
`desk-health/seed/library.tsv` (copied into a viewer's own gitignored `config/library.tsv` at
setup — see `setup.md` §2) — show the `sourceURL` whenever a viewer asks where a movement came
from. Filter every option against the viewer's Section 1.2 answers (movement capacity,
limitations, what's within reach); if a selected area has no compatible catalog item, say so
rather than substituting silently.

Source URLs, for reference:

| optionId | sourceURL |
|---|---|
| `distance-gaze-20s` | https://www.aoa.org/healthy-eyes/eye-and-vision-conditions/computer-vision-syndrome/blue-light |
| `shoulder-rolls`, `hands-open-close`, `seated-slouch-tall`, `stand-walk` | https://www.newcastle-hospitals.nhs.uk/services/newcastle-occupational-health-service/information-for-staff/physiotherapy/self-help-leaflets/1-minute-body-check/ |
| `posture-self-check` | https://www.osha.gov/etools/computer-workstations/positions |

## Extra rotation movements (more than the one default per category)

A row's `optionId` in `routine.tsv` may hold a comma-separated list — the runner rotates through
it, never repeating the immediately-previous pick for that row. To source one beyond the single
built-in default:

1. Use a reputable public-health, occupational-health, or clinical source (same bar as the
   built-in six).
2. Show: exact action, dose, restrictions, source URL, and `minSeconds`.
3. Check it against the viewer's Section 1.2 constraints.
4. Wait for explicit approval before writing it into the viewer's `config/library.tsv` and adding its
   `optionId` to the routine row's rotation list — this goes through the same
   propose→validate→approve→command flow as any other routine edit (see `edit.md`).

If a requested count for one category is unusually high (more than ~4), say so and confirm
before spending that much sourcing/approval time on it.

Never invent an exercise, imply treatment, or silently swap in a substitute. Never invent a
default beyond the single catalog item listed per category above — anything more requires this
explicit sourcing-and-approval step, every time.
