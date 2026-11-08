# 2B1C Bot — floating league chat (prototype)

A floating chat button on the league app. Managers tap it and ask about
the league in plain English. It is a prototype: local answers work now,
full AI answers need a backend (see below).

## Files

- `league-bot.js` — the bot. Self-contained, loaded after `app.js`.
- `league-bot.css` — button + panel styling, using the site theme.
- `index.html` — adds the button/panel markup, the CSS link and the
  `league-bot.js` script tag. No changes to `app.js`.

## How the bot knows who is asking

Managers already log in by picking their team and entering a PIN
(`login()` in `app.js`). On success the app sets `state.manager`,
`state.teamName` and `state.role`, and saves them to `localStorage`.
The bot reads those same values — it never asks for a PIN and never
sends a PIN anywhere.

Manager/team names come from `state.loginBootstrap.managers` or
`state.appData.managers` (each entry has `manager` and `teamName`).
Will is found as team "Berlin Bombers", falling back to a manager
named Will.

## What it can answer locally (no backend)

All local answers come from data the app already syncs through the
Google Apps Script JSONP API — the same read endpoints the dashboard
uses (`espnSettings`, `espnStandings`, `espnScoreboard`,
`espnRosters`, `getAppData`):

- "What is my matchup this week?" / "Who am I playing?" — this week's
  scoreboard game for the logged-in team.
- "Show the standings" — ESPN standings with record and points for.
- "Who is on Berlin Bombers?" / "Who is on my team?" — Week roster,
  starters + bench, from `espnRosters`.
- "Who manages Berlin Bombers?" — manager name from the managers list.
- "What are the payouts?" / "Buy-in?" — `settings.buyIn` / `settings.payouts`
  (defaults $100 / 1st $800 / 2nd $300 / 3rd $100).
- Rules, draft date/time.
- "Any good trades with Will?" — see Trade suggestions below.

## How trade suggestions work

The bot loads both teams' rosters for the live week
(`ensureRosterData_`, the same cache the roster drawer uses) and
compares positional depth at QB / RB / WR / TE:

- Surplus = 3 or more players at a position; thin = 1 or fewer.
- A clean 1-for-1 is suggested when the asker is deep where the other
  team is thin, and the other team is deep where the asker is thin.
- Otherwise it lists one-way fits, or says the rosters look balanced
  on depth alone.
- The named trade piece is the lowest last-week scorer actually
  listed at that lineup slot (bench players are all labelled "Bench"
  with no position field, so they cannot be matched to a slot
  honestly). It is labelled "e.g." — a starting point, not a valuation.

Every trade answer is labelled "Suggestion only" and says nothing was
offered or sent. It is based on roster depth only — not projections,
injuries or byes. The bot cannot do start/sit or waiver calls from
local data alone, and it says so instead of inventing a projection.

## Read-only

The bot never calls `managerLogin`, never posts to the Shit Show,
never votes, and never makes a trade, waiver or lineup change on ESPN
or anywhere else. All user text and league data is rendered with
`textContent`, never as raw HTML.

## AI backend (still needed for full AI answers)

`LEAGUE_BOT_CONFIG` at the top of `league-bot.js`:

```js
var LEAGUE_BOT_CONFIG = {
  aiEndpoint: "",   // set to your backend URL to enable
  aiEnabled: false,
  botName: "2B1C Bot",
  cacheMs: 60000,
};
```

When enabled, questions the bot cannot answer locally are POSTed as
JSON `{ question, manager, teamName, role, context }` to that
endpoint. The backend should return `{ answer: "..." }` as plain text.
The bot never sends a PIN to the backend.

The backend must hold any AI API key server-side. Do NOT put an API
key, token, PIN or any other secret in this repo — the site is a
public GitHub Pages site, so anything in the repo is visible to
everyone.

## Testing

1. Merge the PR, wait for GitHub Pages to publish, hard-refresh.
2. Log in with a team + PIN. The gold chat button appears bottom-right,
   above the bottom nav.
3. Try: "What is my matchup this week?", "Show the standings",
   "Any good trades with Will?", "What are the payouts?"
4. Log out — the button disappears.
