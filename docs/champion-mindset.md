# Champion Mindset

## Scope

`index.html` adds `ChampionMindsetView` and `MindsetDateWheel`, appends the
CHAMPION MINDSET tab, and simplifies the shared header. The trade counter still
reads `trades.length`; the permanent motto is independent of the daily choice.

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

Valid IDs are `tenacity`, `pressure`, `recovery`, `rest`, and `finish`.
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
- Desktop uses a 28/72 grid; mobile places the wheel above all five statements.
- Quote selection uses native radio inputs with visible focus and one choice.

## Validation

Run the dedicated suite with Node and Babel standalone 7.23.2:

```powershell
$env:JOURNAL_BABEL_PATH = 'C:\path\to\babel.cjs'
node tests/journal-mindset-tests.js
```

The 14 test groups cover dynamic header counts, exact copy, local dates, leap
days, navigation, persistence, independent dates, replacement, asynchronous date
changes, write/read failures, malformed data, preservation of unrelated data,
backup/restore, and preservation of the original Playbook field.

Browser checks use synthetic data and an isolated in-memory test store, never
the user's browser data. Tested desktop and mobile layouts, native scrolling,
date centering, quote selection, refresh persistence, replacing a choice,
unassigned dates, month/year navigation, and a simulated full-storage failure.
The existing audit, backup, Execution, MAE/MFE, parser/week and streak/extremes
suites also pass, including full JSX/Babel validation.
