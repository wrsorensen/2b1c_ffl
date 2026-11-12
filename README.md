[README.txt](https://github.com/user-attachments/files/34756384/README.txt)
2B1C FFL — v1.6.19
===================

Files in this package (replace these 3):
- index.html
- app.js
- styles.css

No Code.gs change needed - this release only uses data that was already
flowing from v1.6.18's diagnostic (confirmed live: ESPN sends real
projected scores for every matchup).

What changed:
Scoreboard card now shows each game's ESPN-projected score instead of 0-0
until that specific game has a real score in. This is per game, not per
week - Thursday night can go live while Sunday's games still show
projected, automatically, with zero clock/timezone logic. Projected rows
get a subtle gold tint + a small "Proj." tag. If every game in the week is
still projected, the card title swaps from "Scoreboard" to "Projected" and
the whole card gets the same tint; the moment any game goes live, both
revert to normal.

Not touched: Pay tab, dues tracking, Commish Tools, Version History,
login/auth, Code.gs.

Install:
1. Replace index.html, app.js, styles.css in the repo with these 3.
2. Commit + push to main, rebuild Pages if it doesn't auto-build.
3. No Apps Script changes required.

Test checklist:
- Before any games kick off this week: Scoreboard card title reads
  "Projected", card has a subtle gold tint, every row shows a projected
  number with a small "Proj." tag.
- After Thursday night kicks off (or any game goes live): that one row
  switches to its real live score, tag/tint disappears from that row only;
  other still-not-started games keep showing "Proj." Card title/tint
  reverts to normal "Scoreboard" since the week's now mixed.
- Browsing a past completed week (week picker): normal real scores, no
  projected tint anywhere (all real scores are nonzero/final).
- Mobile layout: projected tag doesn't break the row layout or wrap badly.
