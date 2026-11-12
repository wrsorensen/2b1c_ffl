[Uploading README.txt…]()
2B1C FFL — v1.6.24
===================

Files (replace these 3):
- index.html
- app.js
- styles.css

Covers everything built in the canvas, v1.6.21 through v1.6.24:

v1.6.21 - Scoreboard header redesign. Removed the collapse-toggle and the
separate status chip. Whole header is now one centered, clickable title
("Projected - Week N" / "Live Scoreboard - Week N" / "Scoreboard -
Week N") that opens the week picker. Green live-week dot moved out of the
card, up next to "Updated ..." at the top of Home.

v1.6.22 - Added prev/next week arrows flanking the title - step one week
at a time without opening the full picker. Tapping the title text itself
still opens the picker for bigger jumps.

v1.6.23 - Arrows moved to the outer edges of the header bar, dropped the
circular button chrome - just the glyph now.

v1.6.24 - Title and arrows vertically centered as a group.

Builds on v1.6.19/v1.6.20 (projected scoreboard tint/data), already live.

Not touched: Pay tab, dues tracking, Commish Tools, Version History,
login/auth, Code.gs.

Install:
1. Replace index.html, app.js, styles.css.
2. Commit + push to main, rebuild Pages if it doesn't auto-build.
3. No Apps Script changes required.

Test checklist:
- Scoreboard card: header is one row, centered title, small arrow on each
  outer edge, everything vertically aligned.
- Tap left/right arrow: steps one week, doesn't open the picker.
- Tap the title text (middle): opens the full week picker.
- Scoreboard card no longer collapses when tapped (that's intentional -
  only week-browsing now, not collapse).
- Green dot only shows next to "Updated ..." when viewing the live/current
  week; disappears when browsing a past week.
- Mobile: arrows are easy to tap without missegating onto the title tap
  target.
