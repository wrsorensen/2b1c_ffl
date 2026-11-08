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
  var cache = { standings: null, standingsAt: 0, settings: null, settingsAt: 0, scoreboard: {}, rosters: {} };

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
    var list = (standings || []).map(function (t) {
      return { teamName: t.teamName || "", teamId: t.teamId, manager: "" };
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
    var who = me();
    var standings = [];
    try { standings = await fetchStandings(); } catch (e) {}

    if (!q) return "Ask me something about the league — standings, your matchup, a roster, payouts, or a trade idea.";

    if (/^(hi|hey|hello|yo)\b/.test(q) || q.indexOf("what can you do") !== -1 || q.indexOf("help") !== -1) {
      return "Hey " + (who.manager || "manager") + " — I know your team (" + (who.teamName || "not set") + ") and I can see the league. Try:\n" +
        "• \"What is my matchup this week?\"\n• \"Show the standings\"\n• \"Who is on Will's team?\"\n• \"Any good trades with Will?\"\n• \"What are the payouts?\"\n\nLocal answers come from ESPN data already in the app. For start/sit and waiver advice I will need the AI backend connected — see LEAGUE_BOT.md.";
    }

    if (q.indexOf("who am i") !== -1 || q.indexOf("my team") !== -1 && q.indexOf("roster") === -1 && q.indexOf("matchup") === -1 && q.indexOf("record") === -1 && q.indexOf("who is on") === -1 && q.indexOf("who's on") === -1) {
      return "You are logged in as " + (who.manager || "unknown") + ", team " + (who.teamName || "unknown") + (who.role ? " (" + who.role + ")" : "") + ".";
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

    if (q.indexOf("standing") !== -1 || q.indexOf("who is first") !== -1 || q.indexOf("who is last") !== -1 || q.indexOf("playoff") !== -1) {
      if (!standings.length) return "Standings have not loaded yet — try again in a moment.";
      var lines = standings.map(function (t, i) {
        return (i + 1) + ". " + (t.teamName || "Team " + t.teamId) + " — " + formatRecord(t) + ", " + Number(t.pointsFor || 0).toFixed(1) + " PF";
      });
      return "Standings (Week " + (await liveWeek()) + "):\n" + lines.join("\n");
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
      "I can answer: standings, your matchup, a team roster, rules, payouts, and \"Any good trades with Will?\" " +
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
