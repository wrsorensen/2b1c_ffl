[README.txt](https://github.com/user-attachments/files/34781581/README.txt)
2B1C FFL — v1.6.25
===================

Files (replace these 3):
- index.html
- app.js
- styles.css

Three fixes from live testing:

1. Real bug: loadEspnDashboard() called loadHotSheet_() with no week arg
   on every refresh, including the 25s auto-refresh timer - so while you
   were reading a past week's Hot Sheet, it would silently snap back to
   the live week's recap on the next auto-refresh. Fixed to respect
   whichever week you're actually viewing, same rule the week picker
   already used.

2. Header logo (top-left brand area) is now tappable.

3. Tapping the header logo OR the bottom-nav Home button now resets
   Scoreboard back to the live/current week - previously Home just
   switched tabs and left you on whatever past week you'd arrowed/picked
   to.

Not touched: Pay tab, dues tracking, Commish Tools, Version History,
login/auth, Code.gs.

Install:
1. Replace index.html, app.js, styles.css.
2. Commit + push, rebuild Pages if needed.

Test checklist:
- Arrow back to a past week's Hot Sheet, wait ~30s (or longer) without
  touching anything - Hot Sheet should still show that past week, not
  snap back to current.
- Tap the header logo from any tab (Rules, Champs, Pay, Shit Show) -
  lands on Home.
- Arrow back a few weeks on Scoreboard, then tap the header logo - should
  land on Home AND Scoreboard should be back on the live/current week,
  not wherever you'd arrowed to.
- Same test, but tap the bottom-nav Home button instead of the logo -
  same result.
- Normal refresh/auto-refresh while already on the live week - no change,
  still just works as before.
