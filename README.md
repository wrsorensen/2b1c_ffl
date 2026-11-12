[README.txt](https://github.com/user-attachments/files/34723107/README.txt)
2B1C FFL — v1.6.17
===================

Files in this package:
- index.html (version string only)
- Code.gs sent separately as a raw file (Apps Script editor, not this repo)

Real bug, not a frontend issue: both getReleaseNotesPublic_ and
getReleaseNotesAdminPublic_ just did .reverse() on sheet row order,
assuming rows were always appended oldest-to-newest. They weren't, so
order was already unreliable. Fixed by sorting on the actual version
number instead (v1.6.X parsed and compared numerically) - immune to row
order from here on.

Separately: the ReleaseNotes sheet had zero rows past v1.6.10 - six real
shipped versions (v1.6.11-v1.6.16) just had no entry at all, which is why
"the newest ones aren't even listed." Backfilled those 6 rows directly in
the Sheet (dates are approximate - "Nov 2026" - since exact per-version
ship dates weren't tracked; edit the Date cells yourself if you want exact
days). Visibility defaults: anything player-facing (Settings redesign, Pay
tab buttons, dues tracking) set TRUE; pure Commish-Tools-internal changes
set FALSE. Flip any of them with the toggle in Settings > Version History.

Install:
1. Replace index.html in the repo with this one (only change: version
   string, now v1.6.17).
2. Paste the attached Code.gs into the Apps Script editor, deploy.
3. ReleaseNotes sheet already updated - nothing to do there.

Test checklist:
- Settings > Version History (any manager): now shows v1.6.11 through
  v1.6.16 entries, newest-first by actual version number.
- Same screen as Will (commissioner): toggles present, all rows visible
  including the FALSE ones, same order.
- Flip a toggle, confirm it sticks and the public list respects it.
