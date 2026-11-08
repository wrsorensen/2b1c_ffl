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
- "What are my chances to make the playoffs?" — see Playoff chances below.

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

## Playoff chances

- Ask: "What are my chances to make the playoffs?", "playoff odds",
  "will I make the playoffs?", "my playoff chances" — for yourself or
  any named team ("What are Berlin Bombers' chances to make the
  playoffs?").
- The answer gives the percentage, current record, remaining opponents
  with their records, points for/against, and a one-line explanation of
  how it was calculated. It never just lists the standings.
- Primary source: odds synced into `fantasypros-sync.json` (teams
  section) — see "FantasyPros sync" below. `playoff-odds.json` is
  kept as a fallback for odds only. The static site cannot log in to
  FantasyPros itself and no credentials ever go in the repo.
- Fallback (only when no synced odds are on file for that team): an
  internal Monte Carlo simulation, 2,000 runs, from league data only.
  Each team's expected weekly score is its points-for average so far;
  each game is simulated with an 18-point weekly spread; division
  winners get in first, then wild cards by wins, then points for.
  Playoff spots come from ESPN settings if present, else the rules
  text, else an assumed 6 (stated in the answer). The RNG is seeded,
  so the same league data gives the same percentage every time.
- Presentation rule: a normal answer does NOT name where the number
  came from. Source and as-of date live in `fantasypros-sync.json` /
  `playoff-odds.json` and in the bot's in-memory `lastPlayoffSource`,
  and are only revealed when the user asks "where did that come from?",
  "what's the source?" or "how current is that?". The same rule applies
  to other answers where practical: give the answer cleanly, source on
  request only.

## FantasyPros sync — everything the bot can answer from synced data

One file, `fantasypros-sync.json` (schemaVersion 1), is the bot's
source for everything FantasyPros provides. The bot reads
`state.appData.fantasyProsSync` first if the Apps Script backend ever
serves it, otherwise the file. It never logs in to FantasyPros and no
credentials are in the repo.

### Schema

```json
{
  "schemaVersion": 1,
  "source": "FantasyPros My Playbook",
  "asOf": "2026-11-08",
  "week": 9,
  "league": "2B1C",
  "coverage": { "seeded": ["..."], "pendingSync": ["..."], "notApplicable": ["..."] },
  "teams": [
    { "teamName": "Berlin Bombers", "manager": "Will",
      "playoffPct": 99, "playoffGreaterThan": true,
      "championshipPct": 45, "projectedRecord": "11-3",
      "teamGrade": "A", "powerRank": 1,
      "matchupOutlook": { "opponent": "Dominator", "projectedPoints": 118.5,
        "opponentProjectedPoints": 105.2, "winPct": 68 },
      "lineup": [{ "player": "Name", "position": "QB", "slot": "QB",
        "projectedPoints": 21.5, "startSit": "start" }] }
  ],
  "rankings": {
    "weekly": { "QB": [], "RB": [], "WR": [], "TE": [{ "rank": 1, "player": "Brock Bowers", "team": "LV", "ecr": 1 }], "K": [], "DST": [], "FLEX": [] },
    "ros": { "QB": [], "RB": [], "WR": [], "TE": [], "K": [], "DST": [], "FLEX": [] }
  },
  "waivers": [{ "player": "Name", "position": "WR", "team": "MIA", "priority": 1, "reason": "..." }],
  "trades": {
    "values": [{ "player": "Name", "position": "WR", "value": 42 }],
    "suggestions": [{ "fromTeam": "A", "toTeam": "B", "gives": "Player X", "receives": "Player Y", "reason": "..." }]
  },
  "news": [{ "player": "Name", "position": "QB", "team": "DAL", "status": "Healthy", "note": "..." }]
}
```

### What the bot answers from the sync file (any manager/team, not just Will)

- Playoff odds + championship odds + projected record (see above).
- Start/sit: "Who should I start this week?", "Who should [team]
  start?" — from a team's `lineup` (`startSit` + `projectedPoints`).
- Waivers: "Who should I pick up?", "best waiver pickup" — from
  `waivers`, in priority order.
- Trade values / finder: "What is the trade value of [player]?",
  "trade finder" — from `trades.values` / `trades.suggestions`.
  The old depth-based trade look ("Any good trades with Will?") still
  works from ESPN rosters and is labelled suggestion only.
- Team grades / power rankings: "Rate my team", "power rankings" —
  from `teamGrade` / `powerRank`.
- Matchup outlook: "What is my matchup outlook?" — from
  `matchupOutlook` (projected points + win %); falls back to the
  scoreboard if a team has none on file.
- Rankings: "Who is the top RB this week?", "ROS ranking for
  [player]?", "Rank [player] vs [player] this week / ROS?" — from
  `rankings.weekly` / `rankings.ros`, with ECR where present.
- Player news / injury: "Is [player] injured?", "News on [player]?" —
  from `news`.

### Coverage as of 2026-11-08 (Week 9) — what is seeded, what is not

- Seeded: Berlin Bombers playoff odds (>99%), championship odds
  (45%), projected record (11-3). Week 9 TE rankings, top 12, with
  ECR (Bowers, Kittle, McBride, LaPorta, Loveland, Fannin, Likely,
  Warren, Kraft, Pitts, Hockenson, Kelce).
- NOT yet synced (empty in the file, bot says so honestly instead of
  guessing): weekly rankings for QB/RB/WR/K/DST/Flex, all ROS
  rankings, start/sit lineups and projections for all 12 teams,
  waiver targets, trade values and suggestions, team grades and power
  rankings, matchup outlooks, player news/injuries, and playoff odds
  for the other 11 teams.
- Not applicable: dynasty rankings — this is a redraft league, so
  they are not synced and the bot does not invent them.
- Why not everything yet: the sync is a manual copy from FantasyPros
  My Playbook (browser sign-in). The bot cannot pull it itself, and
  no FantasyPros login can live in a public repo.

### Sync step (commissioner or Muse, weekly)

1. Sign in to FantasyPros in a browser, open My Playbook.
2. Copy the week's numbers into `fantasypros-sync.json`: for each
   2B1C team — playoff %, championship %, projected record, grade,
   power rank, matchup outlook, lineup with projected points and
   start/sit calls; plus weekly + ROS rankings by position, waiver
   targets in priority order, trade values and suggestions, and player
   news/injuries.
3. Update `asOf` and `week` in the file, and update the `coverage`
   lists (move items from `pendingSync` to `seeded`).
4. Commit and push. GitHub Pages redeploys the site with the new data.
   Refresh at least weekly — everything goes stale after each week's
   games.


## Verify-on-demand — how fresh numbers get pulled

Managers do NOT have their own FantasyPros accounts. The bot uses
Will's account, and only Will's account, to pull the numbers. The
problem that made this necessary: an automated browser keeps failing
FantasyPros' "Verify you are human" check, so a bot-driven sign-in
does not work. A human passes that check. So the check is done by
the CURRENT manager, in their own session, when fresh numbers are
needed.

### Step by step

1. The bot needs fresh numbers — the synced file is missing or more
   than 7 days old, or a question needs a category that is not synced
   yet. The bot shows a "Verify to refresh" button (a chip in the
   panel, and a bar under the chips) and explains the check in one
   line. It never blocks on this: if the manager does nothing, the
   bot keeps answering from the last synced numbers and says how old
   they are.
2. The manager taps "Verify to refresh". The bot opens the sync
   service's verify page in a new tab:
   `{syncEndpoint}/verify?session=...&manager=...&team=...`
   That page shows a human "Verify you are human" check. The manager
   completes it in their own browser. That is the whole point of the
   flow — a human check, done by a human.
3. The bot polls `{syncEndpoint}/verify-status` for up to 60 seconds.
   On "verified" it marks this session verified and calls
   `{syncEndpoint}/refresh` with `{ sessionId, manager, teamName }`.
4. The sync service — the ONLY place Will's FantasyPros session
   lives — does one read-only pull from FantasyPros, filters it to
   2B1C teams only, and returns the fresh `fantasypros-sync.json`.
   The bot filters 2B1C-only a second time before it trusts the
   reply (see "2B1C only" below), reloads its cache, and answers
   from the fresh numbers.
5. The check expires after `verifySessionMinutes` (30 minutes) or on
   logout. After that the manager verifies again. Closing the browser
   clears it automatically — the verification lives in memory only.

### What is NOT shared

- The bot serves 2B1C ONLY. Will's other leagues — Wichita Barn
  Burners (Sleeper) and Sloppy Seconds (MyFantasyLeague) — are never
  included, shown, or reachable through the bot. The sync service
  filters to 2B1C before writing the file, and the bot drops any
  team named Wichita Barn Burners or Sloppy Seconds, any team with a
  league field that is not 2B1C, and rejects a sync file for a
  different league outright.
- No FantasyPros password, session token, or PIN is ever in the repo,
  in the browser, or sent by the bot. The bot never calls
  `managerLogin` and never asks for a PIN. The manager's PIN logs
  them into the 2B1C app only.
- The verification is per-session only: no token is stored in the
  app (no localStorage, no cookie set by the bot), and nothing
  persists after logout or browser close.

### If verification fails

- The check fails, times out, or the manager cancels: the bot says
  so, changes nothing, and keeps answering from the last synced
  numbers, labelled with the as-of date ("synced 3 days ago
  (2026-11-08)").
- If the sync service is not connected yet (`syncEndpoint` empty /
  `syncEnabled` false in `LEAGUE_BOT_CONFIG`): the bot says the
  fresh pull is not wired up yet, gives the freshness of what it
  has, and does not pretend a verify will work.

### What the sync service still has to be (the remaining backend piece)

The client side in this branch is built, but the live pull needs the
sync service itself, which does not exist yet. It must:
- Hold Will's FantasyPros session server-side (commissioner-managed),
  scoped to read-only My Playbook data for the 2B1C league.
- Host the verify page and the `/verify-status` + `/refresh`
  endpoints described in `LEAGUE_BOT_CONFIG` in `league-bot.js`.
- On refresh, pull the full FantasyPros set from the PR #2 schema
  (playoff odds, projections, start/sit, waivers, trade values,
  grades, power rankings, matchup outlook, weekly + ROS rankings,
  news), filter to 2B1C teams only, and return it as
  `fantasypros-sync.json` with `asOf` / `week` updated.
- Never accept a FantasyPros password from the browser, never expose
  Will's session to the site, and never return a team outside 2B1C.
- Until that service exists, the weekly manual sync in "Sync step"
  below is the way fresh numbers get in — the bot reads the same
  file either way, so nothing in the bot changes when the service
  lands.

### Voice / presentation

- The bot's normal answers do not name where a number came from.
  Source and as-of date are only revealed when asked ("where did
  that come from?", "how current is that?").
- Trash talk stays on top of the facts, fantasy performance only,
  emojis sparingly. A failed verification gets a light roast at most
  ("no worries, nothing changed") — never blame the manager.

## Voice: trash talk (with emojis, sparingly)

- The bot talks like the app: "No mercy. No refunds." / Shit Show
  tone. Playful, confident roasting based on fantasy performance only
  — records, points, matchups. Examples: hyping a 6-2 team, teasing a
  3-5 team, calling out a bad trade idea.
- Trash talk goes on TOP of the facts, never instead of them. The
  answer is accurate first, roast second.
- Limits: fantasy / league performance only. No personal attacks
  outside fantasy, no slurs, no harassment about real-life traits.
- If a question is sensitive or the user asks for a straight answer
  ("straight answer", "just the facts", "no trash talk", "be serious"),
  give the straight answer with no roast.
- Emojis: use them where they fit the trash-talk / league tone, one
  to punctuate a roast or a win (a crown for a 6-2 team, a trophy for
  championship chances, a skull for a dead season) — not on every
  line. Keep answers readable on mobile.

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

Test locally BEFORE merging — merging is shipping, not testing.

1. Check out the branch, serve it locally (`python3 -m http.server`),
   open it in a browser.
2. Log in with a team + PIN. The gold chat button appears bottom-right,
   above the bottom nav.
3. Try: "What is my matchup this week?", "Show the standings",
   "Any good trades with Will?", "What are the payouts?",
   "What are my chances to make the playoffs?"
4. Verify flow: with the sync service not connected, tap "Verify to
   refresh" — the bot must say the fresh pull is not wired up yet and
   fall back to the last synced numbers. With a mock sync service,
   verify must unlock a fresh pull, and the session must expire on
   logout (button disappears, verify bar hides).
5. Log out — the button disappears.
