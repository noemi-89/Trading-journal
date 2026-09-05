# Champion Mindset

## Scope

`index.html` adds `ChampionMindsetView` and `MindsetDateWheel`, appends the
CHAMPION MINDSET tab, and simplifies the shared header. The trade counter still
reads `trades.length`; the permanent motto is `1% BETTER EVERY DAY.` and is
independent of the daily choice.
The white motto is centered between the greeting and Settings on desktop and
uses the same 36 px font size as the greeting. On mobile it spans a separate
centered row. The section title is centered above the content at 42 px.

Weekly Review and Playbook are the existing shared `WeeklyPlaybookView`.
Only its label changes to "What will I improve?". The stored `change` field and
the existing weekly document logic are unchanged.

No metric, parser, Calendar, Execution, MAE/MFE, risk or equity logic changes.

## Persistence

The existing storage helper saves a JSON object under
`jnl:v2:champion_mindset`. Example:

```json
{"2026-09-03":"pressure","2026-09-02":"rest"}
```

Valid IDs are `tenacity`, `pressure`, `recovery`, `rest`, `finish`, and
`bullish_life` ("NO MATTER WHAT HAPPENS, WE ARE BULLISH ON LIFE.", Noemi),
and `winner_never_quits` ("A QUITTER NEVER WINS, AND A WINNER NEVER QUITS.",
Napoleon Hill).
All previously existing IDs remain unchanged, preserving every existing association.
The quote text and authors live once in `CHAMPION_QUOTES`.
An absent date has no choice. A new choice replaces the ID for that date only.
Clicking an already selected quote leaves it selected and does not write again.

There is no migration. Merely opening the page does not create a storage entry.
Each save re-reads and validates the current map, then uses the existing verified
storage writer. Selection is confirmed only after the save succeeds. A write
failure preserves the previous selection and displays an error. A failed read
or invalid map blocks editing without overwriting the archive.

The full JSON backup/restore already includes every `jnl:v2:` key, so it covers
Champion Mindset without changes. The Calendar trade CSV is unchanged.

## Date Wheel

- Opens on today's local browser calendar date on each section entry.
- Vertical native scroll and snap; click selects and centers a date.
- Rows stay 48 px high, with a 240 px desktop / 144 px mobile viewport.
- Renders a moving 731-day window, recentered near its edges so navigation is
  not restricted to the initially rendered year.
- Keyboard: Up/Down for days, Page Up/Down for months, Shift + Page Up/Down for
  years, Home for today. Month shifts clamp to the last valid day.
- Desktop uses a 72/28 grid with statements on the left and the wheel on the
  right; mobile places the wheel above all seven statements.
- Quote selection uses native radio inputs with visible focus and one choice.

## Validation

Run the dedicated suite with Node and Babel standalone 7.23.2:

```powershell
$env:JOURNAL_BABEL_PATH = 'C:\path\to\babel.cjs'
node tests/journal-mindset-tests.js
```

The 15 test groups cover the dynamic header count and motto, exact copy, local
dates, leap days, navigation, persistence, independent dates, replacement, asynchronous date
changes, write/read failures, malformed data, preservation of unrelated data,
backup/restore, preservation of the original Playbook field, and persistence of
the new quote without changes to the previously supported quote IDs.

Browser checks use synthetic data and an isolated in-memory test store, never
the user's browser data. Tested desktop and mobile layouts, native scrolling,
date centering, quote selection, refresh persistence, replacing a choice,
unassigned dates, month/year navigation, and a simulated full-storage failure.
The existing audit, backup, Execution, MAE/MFE, parser/week and streak/extremes
suites also pass, including full JSX/Babel validation.
