/*!
 * 2B1C FFL - League Bot (prototype)
 *
 * Floating chat bot for the league app. It knows who is asking because the
 * app already logs managers in by team + PIN (see app.js: login() /
 * state.manager / state.teamName). It answers from data the app already
 * syncs through the Google Apps Script JSONP API: ESPN standings,
 * scoreboard, rosters, league settings and rules.
 *
 * READ-ONLY. The bot only calls the read endpoints the dashboard already
 * uses (espnSettings, espnStandings, espnScoreboard, espnRosters,
 * getAppData). It never calls managerLogin, never sends a PIN, never
 * posts to the Shit Show, never votes, and never makes a trade, waiver
 * or lineup change on ESPN or anywhere else. Trade answers are
 * suggestions only.
 *
 * AI BACKEND (placeholder, disabled by default):
 *   Set LEAGUE_BOT_CONFIG.aiEndpoint to your own backend URL and
 *   aiEnabled to true, and the bot will POST questions it cannot answer
 *   locally to that endpoint. The backend must hold any AI API key
 *   server-side. Do NOT put an API key, token, PIN or any other secret
 *   in this file or anywhere in this repo.
 *   The request body is { question, manager, teamName, role, context }
 *   and the expected reply is { answer: "..." } (plain text).
 *   The bot never sends the manager's PIN to the backend.
 */

(function () {
  "use strict";

  var LEAGUE_BOT_CONFIG = {
    aiEndpoint: "",
    aiEnabled: false,
    botName: "2B1C Bot",
    cacheMs: 60000,
  };
  window.LEAGUE_BOT_CONFIG = LEAGUE_BOT_CONFIG;

  var POSITIONS = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"];

  // Trash talk, app voice: "No mercy. No refunds." / Shit Show tone.
  // Fantasy performance ONLY — records, points, matchups. Never personal
  // traits, never slurs, never real-life harassment. It goes on TOP of
  // the facts, never instead of them. If the user asks for a straight
  // answer, straightMode is set in answerLocally and no roast is added.
  var straightMode = false;

  function wantsStraightAnswer(q) {
    return /straight answer|just the facts|no trash|no roast|no joke|serious(ly)?|be serious/.test(q);
  }

  function roastRecord(team) {
    var w = Number(team.wins || 0), l = Number(team.losses || 0);
    var g = w + l;
    if (!g) return "";
    var pct = w / g;
    var name = team.teamName || "that team";
    if (pct >= 0.75) return "Shit Show note: " + name + " is " + formatRecord(team) + " and running the league right now. Everyone else is playing for second. 👑";
    if (pct >= 0.5) return "Shit Show note: " + name + " is " + formatRecord(team) + " — respectable, but nobody is scared yet. 😐";
    if (pct >= 0.34) return "Shit Show note: " + name + " is " + formatRecord(team) + ". The playoffs are still on the table, barely — stop setting your lineup like it is a bye week. 😬";
    return "Shit Show note: " + name + " is " + formatRecord(team) + ". At this point the only thing they are leading the league in is excuses. 💀";
  }

  function playoffRoast(pct, team) {
    var name = team.teamName || "that team";
    if (pct >= 90) return "Shit Show note: " + name + " is basically printing a playoff ticket. 🎟️ Try not to fumble it.";
    if (pct >= 50) return "Shit Show note: " + name + " is in the driver's seat — for now. 😎 One bad Sunday and the whole league will be in the Shit Show about it.";
    if (pct >= 25) return "Shit Show note: " + name + " is still alive, but the margin for error is gone. Win out or start scouting next year's draft. 🫣";
    if (pct >= 10) return "Shit Show note: " + name + " needs a miracle run and a few other teams to completely fall apart. Stranger things have happened. Not many, though. 🙏";
    return "Shit Show note: " + name + " is mathematically alive and spiritually eliminated. The Shit Show has already written the eulogy. ⚰️";
  }
  var cache = { standings: null, standingsAt: 0, settings: null, settingsAt: 0, scoreboard: {}, rosters: {}, odds: null, oddsAt: 0 };
  // Last playoff answer's provenance, kept in memory only. The bot
  // does NOT name its source in a normal answer; it only reveals it
  // when the user asks where a number came from / how current it is.
  var lastPlayoffSource = null;

  /* ---------- identity: who is asking ---------- */

  function managersList() {
    try {
      if (typeof state !== "undefined") {
        if (Array.isArray(state.loginBootstrap && state.loginBootstrap.managers)) return state.loginBootstrap.managers;
        if (Array.isArray(state.appData && state.appData.managers)) return state.appData.managers;
      }
    } catch (e) {}
    return [];
  }

  function me() {
    var manager = "";
    var teamName = "";
    var role = "";
    try {
      if (typeof state !== "undefined") {
        manager = state.manager || "";
        teamName = state.teamName || "";
        role = state.role || "";
      }
    } catch (e) {}
    return { manager: manager, teamName: teamName, role: role };
  }

  function isLoggedIn() {
    try {
      return typeof state !== "undefined" && !!state.loggedIn;
    } catch (e) {
      return false;
    }
  }

  function norm(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function cleanTeamNameOf(m) {
    return String((m && m.teamName) || "").trim();
  }

  // Find a team by team name, manager name, or a partial name.
  // Returns { teamName, teamId, manager } or null. teamId comes from
  // ESPN standings when available, so roster/scoreboard lookups can use it.
  function findTeam(query, standings) {
    var q = norm(query);
    if (!q) return null;
    // Carry the full standings entry (record, points, division) — the
    // playoff answer needs the real record, not a 0-0 placeholder.
    var list = (standings || []).map(function (t) {
      return { teamName: t.teamName || "", teamId: t.teamId, manager: "",
        wins: t.wins, losses: t.losses, ties: t.ties,
        pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst,
        divisionId: t.divisionId };
    });
    managersList().forEach(function (m) {
      var name = cleanTeamNameOf(m);
      if (!name) return;
      var existing = null;
      list.forEach(function (t) { if (norm(t.teamName) === norm(name)) existing = t; });
      if (existing) {
        if (!existing.manager) existing.manager = m.manager || "";
      } else {
        list.push({ teamName: name, teamId: null, manager: m.manager || "" });
      }
    });
    var exact = null, partial = null;
    list.forEach(function (t) {
      var tn = norm(t.teamName), mn = norm(t.manager);
      if (tn === q || mn === q) exact = t;
      else if (!partial && (tn.indexOf(q) !== -1 || q.indexOf(tn) !== -1 || (mn && mn.indexOf(q) !== -1))) partial = t;
    });
    return exact || partial;
  }

  function findWill(standings) {
    return findTeam("Berlin Bombers", standings) || findTeam("Will", standings);
  }

  /* ---------- league data (read-only, same endpoints as the dashboard) ---------- */

  function apiAvailable() {
    return typeof api === "function";
  }

  function getSettings() {
    try {
      if (typeof state !== "undefined" && state.appData && state.appData.settings) return state.appData.settings;
    } catch (e) {}
    return {};
  }

  function getRules() {
    try {
      if (typeof state !== "undefined" && state.appData) {
        return state.appData.rules || state.appData.ruleSettings || [];
      }
    } catch (e) {}
    return [];
  }

  async function fetchStandings() {
    var now = Date.now();
    if (cache.standings && now - cache.standingsAt < LEAGUE_BOT_CONFIG.cacheMs) return cache.standings;
    if (!apiAvailable()) return [];
    var res = await api("espnStandings");
    var list = (res && res.standings) || (res && res.data && res.data.standings) || [];
    cache.standings = list;
    cache.standingsAt = now;
    return list;
  }

  async function fetchSettings() {
    var now = Date.now();
    if (cache.settings && now - cache.settingsAt < LEAGUE_BOT_CONFIG.cacheMs) return cache.settings;
    var settings = getSettings();
    if (apiAvailable()) {
      try {
        var res = await api("espnSettings");
        var espn = res && res.data ? res.data : res;
        if (espn) settings = Object.assign({}, settings, { _espn: espn });
      } catch (e) {}
    }
    cache.settings = settings;
    cache.settingsAt = now;
    return settings;
  }

  async function liveWeek() {
    var settings = await fetchSettings();
    var espn = settings._espn || {};
    return Number(espn.currentMatchupPeriod || espn.scoringPeriodId || (typeof state !== "undefined" && state.liveWeek) || 1) || 1;
  }

  async function fetchScoreboard(week) {
    if (cache.scoreboard[week]) return cache.scoreboard[week];
    if (!apiAvailable()) return [];
    var res = await api("espnScoreboard", { week: week });
    var games = (res && res.scoreboard) || (res && res.data && res.data.scoreboard) || [];
    cache.scoreboard[week] = games;
    return games;
  }

  async function fetchRosters(week) {
    if (cache.rosters[week]) return cache.rosters[week];
    var map = null;
    try {
      if (typeof ensureRosterData_ === "function") {
        map = await ensureRosterData_(week);
      }
    } catch (e) {}
    if (!map && apiAvailable()) {
      var res = await api("espnRosters", { week: week });
      map = {};
      ((res && res.rosters) || []).forEach(function (t) { map[String(t.teamId)] = t; });
    }
    cache.rosters[week] = map || {};
    return cache.rosters[week];
  }

  function rosterForTeam(rosterMap, team) {
    if (!rosterMap || !team) return null;
    if (team.teamId !== null && team.teamId !== undefined && rosterMap[String(team.teamId)]) {
      return rosterMap[String(team.teamId)];
    }
    var found = null;
    Object.keys(rosterMap).forEach(function (k) {
      if (norm(rosterMap[k].teamName) === norm(team.teamName)) found = rosterMap[k];
    });
    return found;
  }

  function playersOf(entry) {
    return (entry && Array.isArray(entry.roster)) ? entry.roster : [];
  }

  function slotCounts(players) {
    var counts = {};
    POSITIONS.forEach(function (p) { counts[p] = 0; });
    players.forEach(function (p) {
      if (p.lineupSlot === "IR") return;
      var slot = String(p.lineupSlot || "").toUpperCase();
      if (counts[slot] !== undefined) counts[slot] += 1;
    });
    return counts;
  }

  function formatRecord(team) {
    var w = Number(team.wins || 0), l = Number(team.losses || 0), t = Number(team.ties || 0);
    return w + "-" + l + (t ? "-" + t : "");
  }

  function playerLine(p) {
    var parts = [p.name || "Unknown"];
    if (p.lineupSlot) parts.push("(" + p.lineupSlot + ")");
    return parts.join(" ");
  }

  /* ---------- trade suggestions (depth-based, suggestions only) ---------- */

  function tradeSuggestions(myEntry, otherEntry, myName, otherName, week) {
    var myPlayers = playersOf(myEntry);
    var otherPlayers = playersOf(otherEntry);
    if (!myPlayers.length || !otherPlayers.length) {
      return "I could not load one of those rosters for Week " + week + " yet, so I cannot compare them. " +
        "Try again after the rosters sync, or tap a team name on the Standings card to see its roster.";
    }
    var myCounts = slotCounts(myPlayers);
    var otherCounts = slotCounts(otherPlayers);
    var tradeSlots = ["QB", "RB", "WR", "TE"];
    function surplus(counts) { return tradeSlots.filter(function (s) { return counts[s] >= 3; }); }
    function thin(counts) { return tradeSlots.filter(function (s) { return counts[s] <= 1; }); }
    var mySurplus = surplus(myCounts), myThin = thin(myCounts);
    var otherSurplus = surplus(otherCounts), otherThin = thin(otherCounts);

    var lines = [];
    lines.push("Trade look: " + myName + " vs " + otherName + " (Week " + week + " rosters, depth only).");
    lines.push(myName + " depth: " + tradeSlots.map(function (s) { return s + " " + myCounts[s]; }).join(", ") + ".");
    lines.push(otherName + " depth: " + tradeSlots.map(function (s) { return s + " " + otherCounts[s]; }).join(", ") + ".");

    var ideas = [];
    // A clean 1-for-1: I am deep where they are thin, and they are deep where I am thin.
    mySurplus.forEach(function (slot) {
      if (otherThin.indexOf(slot) === -1) return;
      otherSurplus.forEach(function (otherSlot) {
        if (myThin.indexOf(otherSlot) === -1) return;
        // The roster data only labels a player by lineup slot (QB/RB/WR/TE/
        // Bench), with no separate position field, so the identifiable
        // piece at a slot is a player actually listed at that slot.
        // Pick the lowest last-week scorer there, labelled "e.g.".
        var myPiece = slotPlayer(myPlayers, slot);
        var otherPiece = slotPlayer(otherPlayers, otherSlot);
        if (myPiece && otherPiece) {
          ideas.push("Swap a " + slot + " for a " + otherSlot + ": e.g. " + myName + " sends " + playerLine(myPiece) +
            " to " + otherName + " for " + playerLine(otherPiece) + ".");
        }
      });
    });

    if (ideas.length) {
      lines.push("");
      lines.push("Ideas that balance both sides:");
      ideas.slice(0, 3).forEach(function (idea, i) { lines.push((i + 1) + ". " + idea); });
    } else {
      var oneWay = [];
      mySurplus.forEach(function (slot) {
        if (otherThin.indexOf(slot) !== -1) {
          var piece = slotPlayer(myPlayers, slot);
          if (piece) oneWay.push(myName + " is deep at " + slot + " (" + myCounts[slot] + ") and " + otherName + " is thin there (" + otherCounts[slot] + ") — e.g. " + playerLine(piece) + " could be the piece, but " + otherName + " would need to send something back " + myName + " actually needs.");
        }
      });
      otherSurplus.forEach(function (slot) {
        if (myThin.indexOf(slot) !== -1) {
          var piece2 = slotPlayer(otherPlayers, slot);
          if (piece2) oneWay.push(otherName + " is deep at " + slot + " (" + otherCounts[slot] + ") and " + myName + " is thin there (" + myCounts[slot] + ") — e.g. " + playerLine(piece2) + " could help " + myName + ".");
        }
      });
      if (oneWay.length) {
        lines.push("");
        lines.push("No clean 1-for-1 jumped out, but there are one-way fits:");
        oneWay.slice(0, 3).forEach(function (idea, i) { lines.push((i + 1) + ". " + idea); });
      } else {
        lines.push("");
        lines.push("No obvious depth mismatch — both rosters look balanced at QB/RB/WR/TE on depth alone. A trade would come down to who you each like more, not a positional hole.");
        if (!straightMode) lines.push("Shit Show note: that is a trade nobody in this league is losing sleep over. 🤷 Bring a real offer or keep the roster you drafted.");
      }
    }
    lines.push("");
    lines.push("Suggestion only — nothing was offered or sent, and this is based on roster depth, not projections, injuries or byes. Check those in ESPN before proposing anything.");
    return lines.join("\n");
  }

  // Lowest last-week scorer listed at exactly this lineup slot.
  // Bench players are all labelled "Bench" with no position field in
  // this app, so they cannot be matched to a slot honestly.
  function slotPlayer(players, slot) {
    var atSlot = players.filter(function (p) { return String(p.lineupSlot || "").toUpperCase() === slot; });
    atSlot.sort(function (a, b) { return Number(a.points || 0) - Number(b.points || 0); });
    return atSlot[0] || null;
  }

  /* ---------- FantasyPros sync file ----------
   * fantasypros-sync.json (or state.appData.fantasyProsSync, same shape)
   * is the one synced file for everything FantasyPros provides: playoff
   * odds, projections, start/sit, waivers, trade values, grades, power
   * rankings, matchup outlook, rankings (weekly / ROS / ECR) and news.
   * The bot never logs in to FantasyPros and no credentials are in the
   * repo — a sync (see LEAGUE_BOT.md) copies the numbers in weekly.
   * Anything not in the file yet gets an honest "not synced yet" answer,
   * never an invented number. */

  var syncCache = { data: null, at: 0 };

  async function fetchFantasySync() {
    var now = Date.now();
    if (syncCache.data && now - syncCache.at < LEAGUE_BOT_CONFIG.cacheMs) return syncCache.data;
    var data = null;
    try {
      if (typeof state !== "undefined" && state.appData && state.appData.fantasyProsSync) data = state.appData.fantasyProsSync;
    } catch (e) {}
    if (!data) {
      try {
        var res = await fetch("fantasypros-sync.json", { cache: "no-store" });
        if (res.ok) data = await res.json();
      } catch (e) { data = null; }
    }
    syncCache.data = data || null;
    syncCache.at = now;
    return syncCache.data;
  }

  function syncTeam(sync, teamName) {
    if (!sync || !Array.isArray(sync.teams) || !teamName) return null;
    var hit = null;
    sync.teams.forEach(function (t) { if (norm(t.teamName) === norm(teamName)) hit = t; });
    return hit;
  }

  function findPlayerInSync(sync, name) {
    var q = norm(name);
    if (!q || !sync) return null;
    var hits = [];
    function scan(list, where) {
      (list || []).forEach(function (p) {
        if (p && norm(p.player) === q) hits.push({ player: p, where: where });
      });
    }
    (sync.teams || []).forEach(function (t) { scan(t.lineup, "lineup of " + t.teamName); });
    ["weekly", "ros"].forEach(function (set) {
      var r = sync.rankings && sync.rankings[set];
      if (r) Object.keys(r).forEach(function (pos) { scan(r[pos], set + " " + pos + " rankings"); });
    });
    (sync.trades && sync.trades.values || []).forEach(function (v) { if (norm(v.player) === q) hits.push({ player: v, where: "trade values" }); });
    (sync.waivers || []).forEach(function (w) { if (norm(w.player) === q) hits.push({ player: w, where: "waiver wire" }); });
    (sync.news || []).forEach(function (n) { if (norm(n.player) === q) hits.push({ player: n, where: "player news" }); });
    return hits[0] || null;
  }

  function posFromQuestion(q) {
    if (/\bqb\b|quarterback/.test(q)) return "QB";
    if (/\brb\b|running back/.test(q)) return "RB";
    if (/\bwr\b|wide receiver/.test(q)) return "WR";
    if (/\bte\b|tight end/.test(q)) return "TE";
    if (/\bk\b|kicker/.test(q)) return "K";
    if (/\bdst\b|defense/.test(q)) return "DST";
    if (/\bflex\b/.test(q)) return "FLEX";
    return null;
  }

  function notSyncedYet(what) {
    return "I do not have " + what + " in the synced data yet — it needs a fresh sync from My Playbook (see LEAGUE_BOT.md), and until then I would rather say so than guess. Ask me about standings, matchups, rosters, payouts, playoff chances or a trade idea instead.";
  }

  async function answerRankings(q, rawQuestion) {
    var sync = await fetchFantasySync();
    var isRos = q.indexOf("ros") !== -1 || q.indexOf("rest of season") !== -1 || q.indexOf("rest-of-season") !== -1;
    var setName = isRos ? "ros" : "weekly";
    var setLabel = isRos ? "rest-of-season" : "Week " + ((sync && sync.week) || "current");
    // "rank A vs B" — compare two players in the same set.
    var vs = rawQuestion.match(/(.+?)\s+(?:vs\.?|versus|or)\s+(.+?)\s*(?:this week|ros|rest of season)?[?.!]*$/i);
    if (vs && (q.indexOf("rank") !== -1 || q.indexOf("vs") !== -1)) {
      var aName = vs[1].replace(/.*(?:rank|compare)\s+/i, "").trim();
      var bName = vs[2].trim();
      var a = findPlayerInSync(sync, aName), b = findPlayerInSync(sync, bName);
      if (a && b && a.player.rank !== undefined && b.player.rank !== undefined) {
        var better = a.player.rank < b.player.rank ? a : b;
        var worse = better === a ? b : a;
        return better.player.player + " ranks higher (" + setLabel + " #" + better.player.rank + ") than " +
          worse.player.player + " (#" + worse.player.rank + ").";
      }
      return notSyncedYet("rankings for " + (aName || "that player") + " and " + (bName || "that player"));
    }
    // "ROS ranking for [player]?" / "ranking for [player]?"
    if (q.indexOf("ranking for") !== -1 || q.indexOf("rank for") !== -1 || q.indexOf("rank of") !== -1) {
      var name = rawQuestion.replace(/.*(?:ranking|rank)\s+(?:for|of)\s+/i, "").replace(/[?.!]*$/, "").trim();
      var hit = findPlayerInSync(sync, name);
      if (hit && hit.player.rank !== undefined) {
        return hit.player.player + " is " + setLabel + " #" + hit.player.rank +
          (hit.player.ecr ? " (ECR " + hit.player.ecr + ")" : "") + " in " + hit.where + ".";
      }
      return notSyncedYet("a " + setLabel + " ranking for " + (name || "that player"));
    }
    // "top RB this week?" / "who is the top QB?"
    var pos = posFromQuestion(q);
    if (pos && (q.indexOf("top") !== -1 || q.indexOf("best") !== -1 || q.indexOf("who is") !== -1)) {
      var list = sync && sync.rankings && sync.rankings[setName] && sync.rankings[setName][pos];
      if (list && list.length) {
        var top = list.slice(0, 5).map(function (p) { return "#" + p.rank + " " + p.player + (p.team ? " (" + p.team + ")" : ""); });
        return "Top " + pos + "s, " + setLabel + ":\n" + top.join("\n") + ".";
      }
      return notSyncedYet(setLabel + " " + pos + " rankings");
    }
    return null;
  }

  async function answerStartSit(q, rawQuestion, who, standings) {
    var sync = await fetchFantasySync();
    var target = findTeam(who.teamName, standings);
    var m = rawQuestion.match(/(?:for|of)\s+(.+?)\s*(?:this week)?[?.!]*$/i);
    if (m && q.indexOf("my ") === -1) target = findTeam(m[1], standings) || target;
    if (!target) return "Which team? Try \"Who should I start this week?\"";
    var st = syncTeam(sync, target.teamName);
    if (!st || !Array.isArray(st.lineup) || !st.lineup.length) return notSyncedYet("a start/sit lineup for " + target.teamName);
    var starts = st.lineup.filter(function (p) { return p.startSit === "start" || p.startSit === "flex"; });
    var sits = st.lineup.filter(function (p) { return p.startSit === "sit" || p.startSit === "bench"; });
    var out = target.teamName + " — start/sit, Week " + ((sync && sync.week) || "") + ":\n" +
      "Start: " + (starts.length ? starts.map(function (p) { return p.player + " (" + p.position + ", " + (p.projectedPoints !== undefined ? p.projectedPoints + " pts" : "no projection") + ")"; }).join(", ") : "none listed") + ".\n" +
      "Sit: " + (sits.length ? sits.map(function (p) { return p.player + " (" + p.position + ")"; }).join(", ") : "none listed") + ".";
    if (!straightMode && st.lineup.some(function (p) { return p.startSit === "sit"; })) {
      out += "\nShit Show note: if you start the guys I just told you to sit, that is on you. 😬";
    }
    return out;
  }

  async function answerWaivers(q) {
    var sync = await fetchFantasySync();
    var list = (sync && sync.waivers) || [];
    if (!list.length) return notSyncedYet("waiver-wire targets");
    var top = list.slice(0, 5).map(function (w, i) {
      return (i + 1) + ". " + w.player + " (" + w.position + (w.team ? ", " + w.team : "") + ")" +
        (w.priority ? " — priority " + w.priority : "") + (w.reason ? ": " + w.reason : "");
    });
    return "Best waiver pickups this week:\n" + top.join("\n") + ".";
  }

  async function answerTradeValue(q, rawQuestion) {
    var sync = await fetchFantasySync();
    var values = (sync && sync.trades && sync.trades.values) || [];
    var suggestions = (sync && sync.trades && sync.trades.suggestions) || [];
    if (q.indexOf("finder") !== -1 || q.indexOf("suggestion") !== -1) {
      if (!suggestions.length) return notSyncedYet("trade finder suggestions");
      return "Trade ideas:\n" + suggestions.slice(0, 3).map(function (s, i) {
        return (i + 1) + ". " + s.fromTeam + " sends " + s.gives + " to " + s.toTeam + " for " + s.receives + (s.reason ? " — " + s.reason : "") + ".";
      }).join("\n") + "\nSuggestion only — nothing was offered or sent.";
    }
    var name = rawQuestion.replace(/.*(?:value of|fair for|fair is|of)\s+/i, "").replace(/[?.!]*$/, "").trim();
    var hit = null;
    values.forEach(function (v) { if (norm(v.player) === norm(name)) hit = v; });
    if (hit) return hit.player + " (" + hit.position + ") — trade value " + hit.value + ".";
    if (!values.length) return notSyncedYet("trade values");
    return notSyncedYet("a trade value for " + (name || "that player"));
  }

  async function answerTeamGrade(q, rawQuestion, who, standings) {
    var sync = await fetchFantasySync();
    var target = findTeam(who.teamName, standings);
    var m = rawQuestion.match(/(?:for|of)\s+(.+?)\s*[?.!]*$/i);
    if (m && q.indexOf("my ") === -1) target = findTeam(m[1], standings) || target;
    if (!target) return "Which team? Try \"Rate my team\".";
    var st = syncTeam(sync, target.teamName);
    if (q.indexOf("power ranking") !== -1) {
      var ranked = (sync.teams || []).filter(function (t) { return t.powerRank; })
        .sort(function (a, b) { return a.powerRank - b.powerRank; });
      if (!ranked.length) return notSyncedYet("league power rankings");
      return "Power rankings:\n" + ranked.map(function (t) { return t.powerRank + ". " + t.teamName; }).join("\n") + ".";
    }
    if (!st || !st.teamGrade) return notSyncedYet("a team grade for " + target.teamName);
    var line = target.teamName + " — team grade " + st.teamGrade + ".";
    if (!straightMode) {
      var g = String(st.teamGrade).toUpperCase();
      line += "\n" + (g.charAt(0) === "A" ? "Shit Show note: an A grade. 🏆 Enjoy it before the rest of the league comes for you."
        : g.charAt(0) === "F" ? "Shit Show note: an F grade. 💀 The Shit Show is going to have a field day."
        : "Shit Show note: a " + st.teamGrade + " grade. Room to talk, room to improve.");
    }
    return line;
  }

  async function answerMatchupOutlook(q, rawQuestion, who, standings) {
    var sync = await fetchFantasySync();
    var target = findTeam(who.teamName, standings);
    if (!target) return "Which team? Try \"What is my matchup outlook?\"";
    var st = syncTeam(sync, target.teamName);
    if (st && st.matchupOutlook) {
      var o = st.matchupOutlook;
      return target.teamName + " vs " + (o.opponent || "TBD") + " — projected " +
        (o.projectedPoints !== undefined ? o.projectedPoints : "?") + " to " +
        (o.opponentProjectedPoints !== undefined ? o.opponentProjectedPoints : "?") +
        (o.winPct !== undefined ? ", " + o.winPct + "% chance to win" : "") + ".";
    }
    return null; // fall through to the scoreboard answer
  }

  async function answerPlayerNews(q, rawQuestion) {
    var sync = await fetchFantasySync();
    var list = (sync && sync.news) || [];
    var hit = null;
    // A name in the question ("Is Will QB1 injured?") beats regex parsing.
    list.forEach(function (n) { if (q.indexOf(norm(n.player)) !== -1) hit = n; });
    var name = rawQuestion.replace(/.*(?:on|about|for)\s+/i, "").replace(/[?.!]*$/, "").trim();
    if (!hit) list.forEach(function (n) { if (norm(n.player) === norm(name)) hit = n; });
    if (hit) return hit.player + " (" + (hit.position || "") + (hit.team ? ", " + hit.team : "") + ") — " + (hit.status || "") + (hit.note ? ": " + hit.note : "");
    if (!list.length) return notSyncedYet("player news / injury updates");
    return notSyncedYet("news on " + (name || "that player"));
  }

  /* ---------- playoff chances ----------
   * Primary: odds synced into playoff-odds.json (or state.appData.playoffOdds,
   * same shape) by the commissioner. The static site cannot log in to
   * FantasyPros itself and no credentials ever go in the repo, so the odds
   * are copied in by a sync (see LEAGUE_BOT.md) and the bot just reads them.
   * Fallback: an internal Monte Carlo simulation from league data only,
   * used only when no synced odds are on file for that team.
   * PRESENTATION RULE: a normal answer gives the percentage, record,
   * remaining opponents and how it was calculated — it does NOT name the
   * source. Source + as-of date are kept in the data / lastPlayoffSource
   * and are only revealed when the user asks where a number came from,
   * what the source is, or how current it is. */

  function oddsFromAppData() {
    try {
      if (typeof state !== "undefined" && state.appData && state.appData.playoffOdds) {
        return state.appData.playoffOdds;
      }
    } catch (e) {}
    return null;
  }

  async function fetchPlayoffOdds() {
    var now = Date.now();
    if (cache.odds && now - cache.oddsAt < LEAGUE_BOT_CONFIG.cacheMs) return cache.odds;
    var data = oddsFromAppData();
    if (!data) {
      try {
        var res = await fetch("playoff-odds.json", { cache: "no-store" });
        if (res.ok) data = await res.json();
      } catch (e) { data = null; }
    }
    cache.odds = data || null;
    cache.oddsAt = now;
    return cache.odds;
  }

  function findOdds(oddsData, teamName) {
    if (!oddsData || !teamName) return null;
    var teams = Array.isArray(oddsData) ? oddsData : (oddsData.teams || []);
    var hit = null;
    teams.forEach(function (t) {
      if (norm(t.teamName) === norm(teamName)) hit = t;
    });
    return hit ? { entry: hit, source: oddsData.source || "", asOf: oddsData.asOf || "", week: oddsData.week } : null;
  }

  // Deterministic RNG so the same league data gives the same estimate
  // every time the question is asked (no flip-flopping percentages).
  function seededRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalSample(rand, mean, sd) {
    var u = Math.max(rand(), 1e-9), v = Math.max(rand(), 1e-9);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function playoffSpots(settings) {
    var espn = (settings && settings._espn) || {};
    var sched = espn.scheduleSettings || {};
    var n = Number(sched.playoffTeamCount || sched.playoffTeams ||
      (settings && (settings.playoffTeams || settings.playoffTeamCount)) || 0);
    if (n > 0) return { spots: n, assumption: null };
    var rulesText = getRules().map(function (r) {
      return String((r.title || "") + " " + (r.text || "") + " " + (r.area || "") + " " + (r.value || ""));
    }).join(" ");
    var m = rulesText.match(/(\d+)\s*(?:playoff|postseason)\s*teams?/i) ||
      rulesText.match(/playoff(?:\s*teams?)?:?\s*(\d+)/i);
    if (m) return { spots: Number(m[1]), assumption: null };
    return { spots: 6, assumption: "Playoff spots are not listed in the league data I can see, so I assumed 6 playoff teams." };
  }

  // Discover remaining opponents from future scoreboards (live week onward).
  // Stops at the first week with no games, so no total-weeks assumption.
  async function remainingSchedule(standings, liveWk) {
    var byId = {};
    standings.forEach(function (t) { byId[String(t.teamId)] = t; });
    var remaining = {};
    standings.forEach(function (t) { remaining[String(t.teamId)] = []; });
    for (var w = liveWk; w <= liveWk + 8; w++) {
      var games = [];
      try { games = await fetchScoreboard(w); } catch (e) { games = []; }
      if (!games.length) break;
      var seen = false;
      games.forEach(function (g) {
        var a = byId[String(g.awayTeamId)], h = byId[String(g.homeTeamId)];
        if (!a || !h) return;
        seen = true;
        remaining[String(a.teamId)].push({ week: w, opponent: h });
        remaining[String(h.teamId)].push({ week: w, opponent: a });
      });
      if (!seen) break;
    }
    return remaining;
  }

  function simulatePlayoffChances(standings, target, liveWk, settings, remaining) {
    var gamesPlayed = function (t) {
      return Math.max(1, Number(t.wins || 0) + Number(t.losses || 0) + Number(t.ties || 0));
    };
    var avg = {};
    standings.forEach(function (t) { avg[String(t.teamId)] = Number(t.pointsFor || 0) / gamesPlayed(t); });
    var spotsInfo = playoffSpots(settings);
    var spots = spotsInfo.spots;
    var sims = 2000, made = 0;
    var rand = seededRandom(liveWk * 1000 + standings.length * 17 + Number(target.teamId || 0));
    var SD = 18; // weekly scoring spread in this half-PPR league (assumption, stated in the answer)
    for (var s = 0; s < sims; s++) {
      var wins = {}, pf = {};
      standings.forEach(function (t) {
        wins[String(t.teamId)] = Number(t.wins || 0);
        pf[String(t.teamId)] = Number(t.pointsFor || 0);
      });
      Object.keys(remaining).forEach(function (id) {
        remaining[id].forEach(function (game) {
          var myScore = normalSample(rand, avg[id], SD);
          var oppScore = normalSample(rand, avg[String(game.opponent.teamId)], SD);
          pf[id] += myScore;
          if (myScore > oppScore) wins[id] += 1;
        });
      });
      // Rank: division winners first (by wins, then points for), then
      // wild cards by wins, then points for — matches the league rules
      // ("win your division or grind for a wild card").
      var divs = {};
      standings.forEach(function (t) {
        var d = (t.divisionId === null || t.divisionId === undefined) ? "all" : String(t.divisionId);
        (divs[d] = divs[d] || []).push(t);
      });
      var inPlayoffs = {};
      Object.keys(divs).forEach(function (d) {
        var sorted = divs[d].slice().sort(function (a, b) {
          return (wins[String(b.teamId)] - wins[String(a.teamId)]) || (pf[String(b.teamId)] - pf[String(a.teamId)]);
        });
        if (sorted[0]) inPlayoffs[String(sorted[0].teamId)] = true;
      });
      var rest = standings.filter(function (t) { return !inPlayoffs[String(t.teamId)]; })
        .sort(function (a, b) {
          return (wins[String(b.teamId)] - wins[String(a.teamId)]) || (pf[String(b.teamId)] - pf[String(a.teamId)]);
        });
      var need = Math.max(0, spots - Object.keys(inPlayoffs).length);
      rest.slice(0, need).forEach(function (t) { inPlayoffs[String(t.teamId)] = true; });
      if (inPlayoffs[String(target.teamId)]) made += 1;
    }
    return {
      pct: Math.round((made / sims) * 100),
      spots: spots, sims: sims, assumption: spotsInfo.assumption, sd: SD,
    };
  }

  async function answerPlayoffChances(target, standings) {
    var week = await liveWeek();
    var settings = await fetchSettings();
    var syncForOdds = await fetchFantasySync();
    var found = null;
    if (syncForOdds) {
      var st2 = syncTeam(syncForOdds, target.teamName);
      if (st2 && st2.playoffPct !== undefined && st2.playoffPct !== null) {
        found = { entry: st2, source: syncForOdds.source || "", asOf: syncForOdds.asOf || "", week: syncForOdds.week };
      }
    }
    if (!found) {
      var oddsData = await fetchPlayoffOdds();
      found = findOdds(oddsData, target.teamName);
    }
    var remaining = standings.length ? await remainingSchedule(standings, week) : {};
    var myRemaining = remaining[String(target.teamId)] || [];
    var oppLine = myRemaining.length
      ? myRemaining.map(function (g) {
          return "Week " + g.week + " vs " + g.opponent.teamName + " (" + formatRecord(g.opponent) + ")";
        }).join(", ")
      : "No remaining games found in the schedule I can see.";
    var header = target.wins !== undefined && target.wins !== null
      ? target.teamName + " — " + formatRecord(target) + ", " +
        Number(target.pointsFor || 0).toFixed(1) + " points for, " +
        Number(target.pointsAgainst || 0).toFixed(1) + " points against."
      : target.teamName + " — standings have not synced yet, so I cannot show the record right now.";

    if (found) {
      var pct = Number(found.entry.playoffPct);
      var pctText = (found.entry.playoffGreaterThan && pct >= 99) ? "over 99%" : pct + "%";
      lastPlayoffSource = {
        teamName: target.teamName, kind: "synced odds",
        source: found.source || "the synced odds file", asOf: found.asOf || "",
        week: found.week || week,
      };
      var lines = [header, "Playoff chances: " + pctText + "."];
      if (found.entry.championshipPct !== undefined && found.entry.championshipPct !== null) {
        lines.push("Championship chances: 🏆 " + Number(found.entry.championshipPct) + "%.");
      }
      if (found.entry.projectedRecord) lines.push("Projected final record: " + found.entry.projectedRecord + ".");
      lines.push("Remaining: " + oppLine + ".");
      lines.push("How I got that: it factors in your record, points scored, and remaining schedule.");
      if (!straightMode) lines.push(playoffRoast(pct, target));
      return lines.join("\n");
    }

    // Fallback — no synced odds on file for this team.
    if (!standings.length) {
      return target.teamName + " — standings have not loaded yet, so I cannot work out a playoff estimate. Try again in a moment.";
    }
    var sim = simulatePlayoffChances(standings, target, week, settings, remaining);
    lastPlayoffSource = {
      teamName: target.teamName, kind: "internal estimate",
      source: "an internal simulation from league data only (no synced odds on file for this team)",
      asOf: "", week: week,
    };
    var out = [header, "Playoff chances: about " + sim.pct + "% (" + sim.spots + " playoff spots)."];
    out.push("Remaining: " + oppLine + ".");
    out.push("How I got that: I ran " + sim.sims + " simulations of the remaining games, using each team's points-per-week average so far and a " + sim.sd + "-point weekly spread, then counted how often " + target.teamName + " finished in a playoff spot.");
    if (sim.assumption) out.push(sim.assumption);
    if (!straightMode) out.push(playoffRoast(sim.pct, target));
    return out.join("\n");
  }

  async function answerPlayoffSource(targetName) {
    var standings = [];
    try { standings = await fetchStandings(); } catch (e) {}
    var target = null;
    if (targetName) target = findTeam(targetName, standings);
    if (!target && lastPlayoffSource) target = { teamName: lastPlayoffSource.teamName };
    if (!target) target = findTeam(me().teamName, standings);
    var oddsData = await fetchPlayoffOdds();
    var found = target ? findOdds(oddsData, target.teamName) : null;
    if (found) {
      return "The playoff chances for " + target.teamName + " came from " +
        (found.source || "the synced odds file") +
        (found.asOf ? ", as of " + found.asOf : "") +
        (found.week ? " (Week " + found.week + ")" : "") +
        ". Those odds are copied into playoff-odds.json by the commissioner — the bot itself cannot log in to that service, and no login is stored in the app.";
    }
    if (lastPlayoffSource && lastPlayoffSource.kind === "internal estimate") {
      return "There are no synced odds on file for " + lastPlayoffSource.teamName +
        ", so that number was an internal estimate: " + lastPlayoffSource.source +
        ". It uses only league data already in this app (records, points for, remaining schedule).";
    }
    return "I have not given a playoff-chances number yet in this chat. Ask \"What are my chances to make the playoffs?\" first, then ask where it came from and I will tell you.";
  }

  /* ---------- AI backend placeholder ---------- */

  async function askAiBackend(question, context) {
    if (!LEAGUE_BOT_CONFIG.aiEnabled || !LEAGUE_BOT_CONFIG.aiEndpoint) return null;
    var res = await fetch(LEAGUE_BOT_CONFIG.aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        manager: context.manager,
        teamName: context.teamName,
        role: context.role,
        context: context.summary || "",
      }),
    });
    if (!res.ok) throw new Error("AI backend returned " + res.status);
    var data = await res.json();
    return (data && (data.answer || data.reply || data.text)) || null;
  }

  /* ---------- answering (local first) ---------- */

  async function answerLocally(rawQuestion) {
    var q = norm(rawQuestion);
    straightMode = wantsStraightAnswer(q);
    var who = me();
    var standings = [];
    try { standings = await fetchStandings(); } catch (e) {}

    if (!q) return "Ask me something about the league — standings, your matchup, a roster, payouts, or a trade idea.";

    if (/^(hi|hey|hello|yo)\b/.test(q) || q.indexOf("what can you do") !== -1 || q.indexOf("help") !== -1) {
      return "Hey " + (who.manager || "manager") + " — I know your team (" + (who.teamName || "not set") + ") and I can see the league. Try:\n" +
        "• \"What is my matchup this week?\"\n• \"Show the standings\"\n• \"Who is on Will's team?\"\n• \"Any good trades with Will?\"\n• \"What are my chances to make the playoffs?\"\n• \"What are the payouts?\"\n\nNo mercy. No refunds. For start/sit and waiver advice I will need the AI backend connected — see LEAGUE_BOT.md.";
    }

    if ((q.indexOf("who am i") !== -1 || q.indexOf("my team") !== -1) && q.indexOf("roster") === -1 && q.indexOf("matchup") === -1 && q.indexOf("record") === -1 && q.indexOf("who is on") === -1 && q.indexOf("who's on") === -1 && q.indexOf("rate") === -1 && q.indexOf("grade") === -1 && q.indexOf("power") === -1) {
      return "You are logged in as " + (who.manager || "unknown") + ", team " + (who.teamName || "unknown") + (who.role ? " (" + who.role + ")" : "") + ".";
    }

    // FantasyPros sync answers — before the depth-based trade branch and
    // the old start/sit limit message, so synced data wins when present.
    if (q.indexOf("trade value") !== -1 || q.indexOf("trade finder") !== -1 || q.indexOf("trade analyzer") !== -1 ||
        (q.indexOf("trade") !== -1 && (q.indexOf("fair") !== -1 || q.indexOf("worth") !== -1))) {
      return answerTradeValue(q, rawQuestion);
    }
    if (q.indexOf("power ranking") !== -1 || q.indexOf("rate my team") !== -1 || q.indexOf("team grade") !== -1 || q.indexOf("grade my team") !== -1) {
      return answerTeamGrade(q, rawQuestion, who, standings);
    }
    if (q.indexOf("matchup outlook") !== -1 || q.indexOf("how will i do") !== -1 || q.indexOf("win chance") !== -1 || q.indexOf("projected points") !== -1) {
      var outlook = await answerMatchupOutlook(q, rawQuestion, who, standings);
      if (outlook) return outlook;
    }
    if (q.indexOf("waiver") !== -1 || q.indexOf("free agent") !== -1 || q.indexOf("pick up") !== -1 || q.indexOf("pickup") !== -1) {
      // "Who should I pick up" is a waiver question, not a start/sit one.
      if (q.indexOf("start") === -1) return answerWaivers(q);
    }
    if ((q.indexOf("ranking") !== -1 || q.indexOf("rank ") !== -1 || q.indexOf("rank ") === 0 || q.indexOf("top ") !== -1) &&
        (q.indexOf("standings") === -1)) {
      var ranked = await answerRankings(q, rawQuestion);
      if (ranked) return ranked;
    }
    if (q.indexOf("injured") !== -1 || q.indexOf("injury") !== -1 || (q.indexOf("news") !== -1 && q.indexOf("what") === -1)) {
      return answerPlayerNews(q, rawQuestion);
    }

    // Trades — check before generic roster questions, because "trades with Will" contains a team name.
    if (q.indexOf("trade") !== -1) {
      var week = await liveWeek();
      var targetName = null;
      var m = rawQuestion.match(/with\s+(.+?)\s*[?.!]*$/i);
      if (m) targetName = m[1].replace(/^(the\s+)?/i, "");
      var other = targetName ? findTeam(targetName, standings) : findWill(standings);
      if (!other) {
        return "I could not find that team. Try \"Any good trades with Will?\" or use a team name from the standings.";
      }
      var myTeam = findTeam(who.teamName, standings);
      if (!myTeam) {
        return "I could not find your team (" + (who.teamName || "unknown") + ") in the standings yet.";
      }
      if (norm(other.teamName) === norm(myTeam.teamName)) {
        return "That is your own team — pick another team to trade with.";
      }
      var rosterMap = await fetchRosters(week);
      var myEntry = rosterForTeam(rosterMap, myTeam);
      var otherEntry = rosterForTeam(rosterMap, other);
      return tradeSuggestions(myEntry, otherEntry, myTeam.teamName, other.teamName, week);
    }

    if (q.indexOf("payout") !== -1 || q.indexOf("buy-in") !== -1 || q.indexOf("buy in") !== -1 || q.indexOf("dues") !== -1 || q.indexOf("how much") !== -1 || q.indexOf("what do i win") !== -1 || q.indexOf("prize") !== -1) {
      var s = getSettings();
      return "Buy-in: " + (s.buyIn || "$100") + ".\nPayouts: " + (s.payouts || "1st $800 / 2nd $300 / 3rd $100") + ".";
    }

    // Source questions — answered from the kept provenance, never volunteered
    // in a normal answer.
    if (q.indexOf("where did") !== -1 && (q.indexOf("come from") !== -1 || q.indexOf("get that") !== -1 || q.indexOf("get this") !== -1) ||
        q.indexOf("what is the source") !== -1 || q.indexOf("what's the source") !== -1 ||
        q.indexOf("how current") !== -1 || q.indexOf("how up to date") !== -1 ||
        q.indexOf("how fresh") !== -1 || q.indexOf("where did you get") !== -1) {
      return answerPlayoffSource();
    }

    // Playoff chances — before the generic standings branch, which also
    // matches the word "playoff" but only lists the standings.
    if ((q.indexOf("playoff") !== -1 || q.indexOf("postseason") !== -1) &&
        (q.indexOf("chance") !== -1 || q.indexOf("odds") !== -1 || q.indexOf("make") !== -1 ||
         q.indexOf("will") !== -1 || q.indexOf("can") !== -1 || q.indexOf("likely") !== -1)) {
      var target = null;
      if (q.indexOf("my ") !== -1 || q.indexOf(" i ") !== -1 || q.indexOf(" i'") !== -1 || /^i\b/.test(q) || q.indexOf("we ") !== -1) {
        target = findTeam(who.teamName, standings);
        // Standings may not have synced yet — the logged-in identity is
        // still enough to answer from synced odds.
        if (!target && who.teamName) target = { teamName: who.teamName, teamId: null, manager: who.manager };
      } else {
        var pq = rawQuestion.replace(/.*(?:for|of|does|will|can)\s+/i, "").replace(/\s*(make|get in|get to|reach|win).*/i, "").replace(/[?.!]*$/, "");
        target = findTeam(pq, standings) || findTeam(who.teamName, standings);
      }
      if (!target) return "Which team? Try \"What are my chances to make the playoffs?\" or \"What are Berlin Bombers' chances to make the playoffs?\"";
      return answerPlayoffChances(target, standings);
    }

    if (q.indexOf("standing") !== -1 || q.indexOf("who is first") !== -1 || q.indexOf("who is last") !== -1 || q.indexOf("playoff") !== -1) {
      if (!standings.length) return "Standings have not loaded yet — try again in a moment.";
      var lines = standings.map(function (t, i) {
        return (i + 1) + ". " + (t.teamName || "Team " + t.teamId) + " — " + formatRecord(t) + ", " + Number(t.pointsFor || 0).toFixed(1) + " PF";
      });
      var out = "Standings (Week " + (await liveWeek()) + "):\n" + lines.join("\n");
      if (!straightMode && standings.length) out += "\n" + roastRecord(standings[standings.length - 1]);
      return out;
    }

    // "this week" also appears in start/sit and waiver questions
    // ("Who should I start this week?") — those must fall through to
    // the honest start/sit limit message below, not the scoreboard.
    if ((q.indexOf("score") !== -1 || q.indexOf("matchup") !== -1 || q.indexOf("who am i playing") !== -1 || q.indexOf("my game") !== -1 || q.indexOf("this week") !== -1) && q.indexOf("start") === -1 && q.indexOf("sit") === -1 && q.indexOf("waiver") === -1 && q.indexOf("free agent") === -1) {
      var wk = await liveWeek();
      var games = await fetchScoreboard(wk);
      if (!games.length) return "No Week " + wk + " scoreboard yet.";
      var myTeamName = norm(who.teamName);
      var myGame = null;
      games.forEach(function (g) {
        if (norm(g.awayTeamName) === myTeamName || norm(g.homeTeamName) === myTeamName) myGame = g;
      });
      if (myGame) {
        return "Your Week " + wk + " matchup: " + (myGame.awayTeamName || "Away") + " " + Number(myGame.awayScore || 0).toFixed(1) +
          " at " + (myGame.homeTeamName || "Home") + " " + Number(myGame.homeScore || 0).toFixed(1) + ".";
      }
      var all = games.map(function (g) {
        return (g.awayTeamName || "Away") + " " + Number(g.awayScore || 0).toFixed(1) + " at " + (g.homeTeamName || "Home") + " " + Number(g.homeScore || 0).toFixed(1);
      });
      return "Week " + wk + " scoreboard:\n" + all.join("\n");
    }

    if (q.indexOf("roster") !== -1 || q.indexOf("who is on") !== -1 || q.indexOf("who's on") !== -1) {
      var wk2 = await liveWeek();
      var target = null;
      if (q.indexOf("my ") !== -1 || q.indexOf("my team") !== -1) target = findTeam(who.teamName, standings);
      else {
        var nameGuess = rawQuestion.replace(/.*(?:on|for)\s+/i, "").replace(/[?.!]*$/, "");
        target = findTeam(nameGuess, standings) || findWill(standings);
      }
      if (!target) return "Which team? Try \"Who is on Berlin Bombers?\" or \"Who is on my team?\"";
      var map = await fetchRosters(wk2);
      var entry = rosterForTeam(map, target);
      var players = playersOf(entry);
      if (!players.length) return "I could not load the roster for " + target.teamName + " for Week " + wk2 + " yet.";
      var starters = players.filter(function (p) { return p.lineupSlot !== "Bench" && p.lineupSlot !== "IR"; });
      var bench = players.filter(function (p) { return p.lineupSlot === "Bench"; });
      var out = target.teamName + " — Week " + wk2 + " roster:\nStarters: " + starters.map(playerLine).join(", ") + ".";
      if (bench.length) out += "\nBench: " + bench.map(playerLine).join(", ") + ".";
      var managers = managersList().filter(function (x) { return norm(cleanTeamNameOf(x)) === norm(target.teamName); });
      if (managers.length) out += "\nManager: " + managers.map(function (x) { return x.manager; }).join(", ") + ".";
      return out;
    }

    if (q.indexOf("who manages") !== -1 || q.indexOf("who is the manager") !== -1 || q.indexOf("manager of") !== -1) {
      var tq = rawQuestion.replace(/.*(?:of|for)\s+/i, "").replace(/[?.!]*$/, "");
      var team = findTeam(tq, standings);
      if (!team) return "Which team? Try \"Who manages Berlin Bombers?\"";
      var mgrs = managersList().filter(function (x) { return norm(cleanTeamNameOf(x)) === norm(team.teamName); });
      if (!mgrs.length) return "I do not have a manager listed for " + team.teamName + ".";
      return team.teamName + " is managed by " + mgrs.map(function (x) { return x.manager; }).join(", ") + ".";
    }

    if (q.indexOf("will") !== -1 && (q.indexOf("team") !== -1 || q.indexOf("roster") !== -1)) {
      var will = findWill(standings);
      if (!will) return "I could not find Will's team (Berlin Bombers) in the standings yet.";
      var wk3 = await liveWeek();
      var map3 = await fetchRosters(wk3);
      var entry3 = rosterForTeam(map3, will);
      var pl = playersOf(entry3);
      if (!pl.length) return "I could not load Berlin Bombers' roster for Week " + wk3 + " yet.";
      return "Berlin Bombers (Will) — Week " + wk3 + ":\n" + pl.map(playerLine).join(", ") + ".";
    }

    if (q.indexOf("rule") !== -1) {
      var rules = getRules();
      if (!rules.length) return "Rules have not loaded yet — check the Rules tab.";
      var hit = rules.filter(function (r) {
        var text = norm((r.title || "") + " " + (r.text || "") + " " + (r.area || ""));
        return q.split(/\s+/).some(function (w) { return w.length > 3 && text.indexOf(w) !== -1; });
      });
      var show = (hit.length ? hit : rules).slice(0, 5);
      return "Rules:\n" + show.map(function (r) { return "• " + (r.title || r.area || "Rule") + ": " + (r.text || r.value || ""); }).join("\n");
    }

    if (q.indexOf("start") !== -1 || q.indexOf("sit") !== -1) {
      var syncedStartSit = await answerStartSit(q, rawQuestion, who, standings);
      if (syncedStartSit) return syncedStartSit;
    }
    if (q.indexOf("start") !== -1 || q.indexOf("sit") !== -1 || q.indexOf("waiver") !== -1 || q.indexOf("free agent") !== -1) {
      return "I cannot do start/sit or waiver calls from local league data alone — I have rosters and scores, but no projections or free-agent list in this app yet. " +
        "That is what the AI backend is for: once LEAGUE_BOT_CONFIG.aiEndpoint is set, I can send your roster and the question to it and bring back an answer. Until then, ESPN / FantasyPros is the honest place for that call.";
    }

    if (q.indexOf("draft") !== -1) {
      var s2 = getSettings();
      return "Draft: " + (s2.draftDate || "September 3, 2026") + " at " + (s2.draftTime || "7:00 PM") + ", " + (s2.draftLocation || "TBD") + ". Snake draft.";
    }

    return null; // no local answer — caller tries the AI backend, then falls back
  }

  async function answer(question) {
    var who = me();
    try {
      var local = await answerLocally(question);
      if (local) return local;
    } catch (e) {
      // Local data failed (e.g. ESPN sync down) — fall through to backend / fallback.
    }
    try {
      var ai = await askAiBackend(question, { manager: who.manager, teamName: who.teamName, role: who.role, summary: "" });
      if (ai) return ai;
    } catch (e) {
      return "The AI backend did not answer (" + (e.message || "error") + "). I can still answer standings, matchups, rosters, rules and payouts from league data — try one of those.";
    }
    return "I do not have a local answer for that yet, and the AI backend is not connected. " +
      "I can answer: standings, your matchup, a team roster, rules, payouts, playoff chances, and \"Any good trades with Will?\" " +
      "To get full AI answers, set LEAGUE_BOT_CONFIG.aiEndpoint in league-bot.js (see LEAGUE_BOT.md). No API keys go in the repo.";
  }

  /* ---------- UI ---------- */

  var fab = null, panel = null, logEl = null, inputEl = null, subEl = null;

  function addMessage(text, whoClass) {
    if (!logEl) return;
    var div = document.createElement("div");
    div.className = "league-bot-msg " + whoClass;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setTyping(on) {
    var t = panel && panel.querySelector(".league-bot-typing");
    if (t) t.classList.toggle("hidden", !on);
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  async function sendQuestion(text) {
    var question = String(text || "").trim();
    if (!question) return;
    addMessage(question, "league-bot-user");
    inputEl.value = "";
    setTyping(true);
    var reply = await answer(question);
    setTyping(false);
    addMessage(reply, "league-bot-bot");
  }

  function refreshIdentity() {
    var who = me();
    if (subEl) {
      subEl.textContent = who.manager
        ? "Asking as " + who.manager + (who.teamName ? " · " + who.teamName : "")
        : "Log in to ask as your team";
    }
    var show = isLoggedIn();
    if (fab) fab.classList.toggle("hidden", !show);
    if (panel && panel.classList.contains("hidden") === false && !show) panel.classList.add("hidden");
  }

  function init() {
    fab = document.getElementById("leagueBotFab");
    panel = document.getElementById("leagueBotPanel");
    if (!fab || !panel) return;
    logEl = panel.querySelector("#leagueBotLog");
    inputEl = panel.querySelector("#leagueBotInput");
    subEl = panel.querySelector("#leagueBotSubtitle");

    fab.addEventListener("click", function () {
      panel.classList.toggle("hidden");
      if (!panel.classList.contains("hidden")) {
        refreshIdentity();
        if (!logEl.dataset.greeted) {
          logEl.dataset.greeted = "1";
          var who = me();
          addMessage("Hey " + (who.manager || "manager") + " — I am the 2B1C Bot. I know your team (" + (who.teamName || "not set") + ") and I can see the league. Ask me about standings, your matchup, a roster, payouts, or a trade idea.", "league-bot-bot");
        }
        inputEl.focus();
      }
    });
    panel.querySelector("#leagueBotClose").addEventListener("click", function () { panel.classList.add("hidden"); });
    panel.querySelector("#leagueBotSend").addEventListener("click", function () { sendQuestion(inputEl.value); });
    inputEl.addEventListener("keydown", function (e) { if (e.key === "Enter") sendQuestion(inputEl.value); });
    panel.querySelectorAll(".league-bot-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { sendQuestion(chip.dataset.q || chip.textContent); });
    });

    refreshIdentity();
    // Login happens after this script loads, and logout can happen any time,
    // so re-check identity on an interval rather than only at load.
    setInterval(refreshIdentity, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
