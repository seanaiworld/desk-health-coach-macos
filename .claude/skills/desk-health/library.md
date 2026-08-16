# library.md — the movement catalog

## Built-in defaults (never invent an alternative to these; use as-is)

Three per category — the first in each group is the original single default.

| optionId | type | action | dose | minSeconds | restrictions |
|---|---|---|---|---|---|
| `distance-gaze-20s` | eyes | Look at something ~20 feet away for 20 seconds | 20 sec | 20 | — |
| `palming` | eyes | Rest palms lightly over closed eyes, no pressure | 30 sec | 30 | — |
| `near-far-focus` | eyes | Focus near, then far, x3 | 3 reps | 20 | not a substitute for care for dyslexia, eye spasms, or similar |
| `shoulder-rolls` | neck-shoulders | Gently roll shoulders 3x forward, 3x back | 6 rolls | 15 | — |
| `chin-tuck` | neck-shoulders | Draw chin straight back, eyes level, x10 | 10 reps | 20 | — |
| `side-neck-stretch` | neck-shoulders | Tilt head toward one shoulder, then the other | 10 reps/side | 40 | ease off if it worsens symptoms |
| `hands-open-close` | wrists-hands | Make a fist, then open and spread fingers, x3 | 3 reps | 10 | — |
| `wrist-side-bend` | wrists-hands | Forearm supported, bend wrist side to side | 5-10 reps/dir | 45 | stop if sharp pain |
| `hook-fist-full-fist` | wrists-hands | Hook fist, then full fist, x10 | 10 reps | 30 | stop if sharp pain |
| `seated-slouch-tall` | lower-back | Seated: gently slouch, then sit tall, x3 | 3 reps | 15 | omit for back pain/limits or uncertainty |
| `standing-back-extension` | lower-back | Hands on lower back, gently lean backward | 3-5 reps | 30 | stop if pain |
| `cat-stretch` | lower-back | Hands and knees: arch back up, return to neutral | 5 reps | 25 | needs floor/kneeling space |
| `stand-walk` | standing | Stand and walk near the desk for 60 seconds | 60 sec | 60 | standing/walking must be allowed |
| `wall-press` | standing | Hands on wall at shoulder height, lean in and press back | 3x10 | 45 | — |
| `standing-thigh-stretch` | standing | Heel toward buttock, hold 20s | 20s x3/leg | 40 | use desk/chair for balance |
| `posture-self-check` | posture | Check head/neck, shoulders, wrists, lower back, feet | one check | 15 | — |
| `chin-tuck-seated` | posture | Seated: draw chin back, hold 5s, x3 | 3x5s | 15 | — |
| `wall-posture-check` | posture | Back to wall, check head/shoulder/lower-back contact | one check | 15 | — |

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

**Pending URLs.** The twelve movements added beyond the original six were verified against these
publishers, but their exact source URLs have not been recorded yet, so their `sourceURL` cells in
`seed/library.tsv` are empty. `validate.js` accepts an empty `sourceURL` but rejects a non-URL
string, so the publisher name cannot be parked in that column. Until these are filled in, the
"show the `sourceURL` when a viewer asks" rule above cannot be honoured for them.

| optionId | publisher (URL still needed) |
|---|---|
| `palming`, `near-far-focus` | WebMD |
| `chin-tuck` | University Hospitals Sussex NHS |
| `side-neck-stretch` | Berkshire Healthcare NHS |
| `wrist-side-bend` | Cambridge University Hospitals NHS |
| `hook-fist-full-fist` | North Tees & Hartlepool NHS |
| `standing-back-extension` | CCOHS (Canada) |
| `cat-stretch` | Newcastle Hospitals NHS |
| `wall-press`, `standing-thigh-stretch` | Mersey Care NHS |
| `chin-tuck-seated`, `wall-posture-check` | Cleveland Clinic |

## Extra rotation movements (more than the three defaults per category)

A row's `optionId` in `routine.tsv` may hold a comma-separated list — the runner rotates through
it, never repeating the immediately-previous pick for that row. The three built-in defaults per
category can be listed there directly. To source one beyond them:

1. Use a reputable public-health, occupational-health, or clinical source (same bar as the
   built-in eighteen).
2. Show: exact action, dose, restrictions, source URL, and `minSeconds`.
3. Check it against the viewer's Section 1.2 constraints.
4. Wait for explicit approval before writing it into the viewer's `config/library.tsv` and adding its
   `optionId` to the routine row's rotation list — this goes through the same
   propose→validate→approve→command flow as any other routine edit (see `edit.md`).

If a requested count for one category is unusually high (more than ~4), say so and confirm
before spending that much sourcing/approval time on it.

Never invent an exercise, imply treatment, or silently swap in a substitute. Never invent a
default beyond the catalog items listed per category above — anything more requires this
explicit sourcing-and-approval step, every time.
