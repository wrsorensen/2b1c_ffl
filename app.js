/*
  2B1C FFL
  v0.5.29 - home redesign
*/
const APPS_SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbx1r1DRzTOZj9wy1NRspGRc-Nq51oypZGl6upojMG4NUGmZMH7GMCPPWBClFRl08rAtaA/exec";
const APP_DATA_CACHE_KEY = "2b1cAppDataCacheV1";
const APP_DATA_CACHE_TIME_KEY = "2b1cAppDataCacheTimeV1";
const LAST_LOADING_LINE_KEY = "2b1cLastLoadingLineV1";
const TRASH_SEEN_KEY = "2b1cTrashSeenKeyV1";

const AUTO_REFRESH_MS = 25000;

const state = {
  loggedIn: false,
  manager: localStorage.getItem("managerName") || "",
  pin: localStorage.getItem("managerPin") || "",
  teamName: localStorage.getItem("teamName") || "",
  currentTab: "home",
  appData: readCachedAppData(),
  lastUpdatedAt: readCachedAppDataTime(),
  loginBootstrap: null,
  trashTimer: null,
  refreshDataLoading: false,
  refreshStatusTimer: null,
  trashSeenKey: localStorage.getItem(TRASH_SEEN_KEY) || "",
  espnDashboardLoading: false,
  espnDashboardLoadedAt: null,
  expandedThreads: new Set(),
  expandedRuleAreas: new Set(),
  ruleQuery: "",
  currentWeek: 1,
  rosterWeek: null,
  rosterByTeamId: null,
  rosterLoading: false,
  draftCentralExpanded: false,
  activeReplyThreadId: "",
  isPostingTrash: false,
  replyingToId: "",
  replyingToTitle: ""
};

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginStatus = document.getElementById("loginStatus");
const loginManagerSelect = document.getElementById("loginManagerSelect");
const loginPinInput = document.getElementById("loginPinInput");
const enterBtn = document.getElementById("enterBtn");
const clearBtn = document.getElementById("clearBtn");
const trashList = document.getElementById("trashList");

const hasSavedLogin = Boolean(state.manager && state.pin);
if (hasSavedLogin) {
  setLoginBusy(true, randomLoadingLine());
}

enterBtn.addEventListener("click", () => login(false));
clearBtn.addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("openNewThreadBtn")?.addEventListener("click", openNewThreadForm);
document.getElementById("cancelNewThreadBtn")?.addEventListener("click", closeNewThreadForm);
document.getElementById("postTrashBtn").addEventListener("click", postTrash);
document.getElementById("refreshTrashBtn").addEventListener("click", () => refreshData(false));
document.getElementById("refreshHomeBtn")?.addEventListener("click", () => refreshData(false));
document.getElementById("standingsRows")?.addEventListener("click", handleTeamRowClick_);
document.getElementById("standingsRows")?.addEventListener("keydown", handleTeamRowKeydown_);
document.getElementById("scoreboardBody")?.addEventListener("click", handleTeamRowClick_);
document.getElementById("scoreboardBody")?.addEventListener("keydown", handleTeamRowKeydown_);
document.getElementById("draftSummaryToggle")?.addEventListener("click", toggleDraftCentralDetail_);

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

loginPinInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});

window.addEventListener("focus", () => {
  if (state.loggedIn && state.currentTab === "trash") refreshData(true);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.loggedIn && state.currentTab === "trash") refreshData(true);
});

init();

async function init() {
  updateClearSavedVisibility();

  if (hasSavedLogin) {
    setLoginBusy(true, randomLoadingLine());
    await login(true);
    return;
  }

  const cachedManagers = state.appData?.managers || [];
  if (cachedManagers.length) {
    renderLoginManagers();
    setLoginStatus("Ready. Pick your team and enter PIN.");
  } else {
    setLoginStatus("Loading teams…", "loading");
  }

  try {
    await loadLoginBootstrap();
    renderLoginManagers();
    setLoginStatus("Ready. Pick your team and enter PIN.");
  } catch (error) {
    if (cachedManagers.length) {
      setLoginStatus("Using saved team list. Enter PIN.");
    } else {
      setLoginStatus("Could not load teams: " + error.message);
    }
  }
}

async function login(isAutoLogin = false) {
  const manager = isAutoLogin ? state.manager : loginManagerSelect.value;
  const pin = isAutoLogin ? state.pin : loginPinInput.value.trim();

  if (!manager || !pin) {
    setLoginStatus("Select team and enter PIN.", "error");
    return;
  }

  setLoginBusy(true, isAutoLogin ? randomLoadingLine() : "Checking team PIN...");

  try {
    const response = await api("managerLogin", { manager, pin });
    const result = response.data || {};

    if (!result.ok) {
      if (isAutoLogin) {
        clearSaved(false);
        setLoginBusy(false);
        renderLoginManagers();
        setLoginStatus("Saved login expired. Login again.", "error");

        loadLoginBootstrap()
          .then(() => renderLoginManagers())
          .catch(() => {});
      } else {
        setLoginBusy(false);
        setLoginStatus(result.message || "Invalid manager/PIN combo.", "error");
      }
      return;
    }

    state.loggedIn = true;
    state.manager = result.manager || manager;

    const bootstrapManager = Array.isArray(state.loginBootstrap?.managers)
      ? state.loginBootstrap.managers.find((m) => m.manager === state.manager)
      : null;

    state.teamName = cleanTeamName(bootstrapManager) || result.teamName || "";
    state.pin = pin;

    localStorage.setItem("managerName", state.manager);
    localStorage.setItem("managerPin", state.pin);
    localStorage.setItem("teamName", state.teamName);

    loginScreen.classList.add("hidden");
    setLoginBusy(false);
    appScreen.classList.remove("hidden");

    if (state.appData) {
      renderApp();
    } else {
      renderAuthenticatedShell();
    }

    startAutoRefresh();

    // Full app data loads after authentication so it cannot block the login path.
    refreshData(true);
  } catch (error) {
    setLoginBusy(false);
    setLoginStatus("Login failed: " + error.message, "error");
  }
}

function clearSaved(showStatus = true) {
  localStorage.removeItem("managerName");
  localStorage.removeItem("managerPin");
  localStorage.removeItem("teamName");
  state.manager = "";
  state.pin = "";
  state.teamName = "";
  state.loggedIn = false;
  loginPinInput.value = "";
  setLoginBusy(false);
  updateClearSavedVisibility();
  if (showStatus) setLoginStatus("Saved login cleared.");
}

function logout() {
  clearSaved(false);
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  showTab("home");
  renderLoginManagers();
  updateClearSavedVisibility();
  setLoginStatus("Logged out. Select team and enter PIN.");
}

async function loadLoginBootstrap() {
  const response = await api("getLoginBootstrap");
  const bootstrap = response.data || {};

  if (!Array.isArray(bootstrap.managers)) {
    throw new Error("Invalid login bootstrap");
  }

  state.loginBootstrap = bootstrap;
  return bootstrap;
}

async function loadData() {
  const response = await api("getAppData");
  const data = response.data;

  if (!data || typeof data !== "object") {
    throw new Error("Invalid app data");
  }

  state.appData = data;
  syncLiveTeamNameFromAppData(data);
  state.lastUpdatedAt = new Date();
  cacheAppData(data);
  return data;
}

function readCachedAppData() {
  try {
    const raw = localStorage.getItem(APP_DATA_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    try {
      localStorage.removeItem(APP_DATA_CACHE_KEY);
    } catch (_) {}
    return null;
  }
}

function readCachedAppDataTime() {
  try {
    const raw = localStorage.getItem(APP_DATA_CACHE_TIME_KEY);
    const time = raw ? Number(raw) : NaN;
    return Number.isFinite(time) ? new Date(time) : null;
  } catch (_) {
    return null;
  }
}

function cacheAppData(data) {
  try {
    localStorage.setItem(APP_DATA_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(APP_DATA_CACHE_TIME_KEY, String(Date.now()));
  } catch (_) {
    // Cache failure must never block the live app.
  }
}

async function refreshData(silent = false) {
  if (!state.loggedIn || state.refreshDataLoading) return;

  state.refreshDataLoading = true;
  const trashStatus = document.getElementById("trashStatus");
  const lastUpdatedText = document.getElementById("lastUpdatedText");
  const shouldShowRefreshState = !silent;

  if (shouldShowRefreshState) {
    setRefreshButtonsState("Refreshing...", true);
  }
  if (shouldShowRefreshState && trashStatus && state.currentTab === "trash") {
    trashStatus.textContent = "Refreshing...";
  }
  if (shouldShowRefreshState && lastUpdatedText) {
    lastUpdatedText.textContent = "Refreshing league data…";
  }

  try {
    await loadData();
    renderApp();

    if (shouldShowRefreshState) {
      flashRefreshButtonsState("Updated");
    }
    if (shouldShowRefreshState && trashStatus && state.currentTab === "trash") {
      trashStatus.textContent = "Updated.";
      setTimeout(() => {
        if (trashStatus.textContent === "Updated.") trashStatus.textContent = "";
      }, 1200);
    }
  } catch (error) {
    if (trashStatus && state.currentTab === "trash") {
      trashStatus.textContent = "Refresh failed: " + error.message;
    }
    if (lastUpdatedText) {
      lastUpdatedText.textContent = "Refresh failed";
    }
    if (shouldShowRefreshState) {
      flashRefreshButtonsState("Try again");
    }
  } finally {
    state.refreshDataLoading = false;
  }
}

function getRefreshButtons_() {
  return [
    document.getElementById("refreshHomeBtn"),
    document.getElementById("refreshTrashBtn")
  ].filter(Boolean);
}

function setRefreshButtonsState(label, isDisabled) {
  clearTimeout(state.refreshStatusTimer);

  getRefreshButtons_().forEach((button) => {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.id === "refreshHomeBtn"
        ? (button.getAttribute("aria-label") || "Refresh data")
        : button.textContent;
    }

    if (button.id === "refreshHomeBtn") {
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = isDisabled;
      button.classList.toggle("is-refreshing", isDisabled);
      return;
    }

    button.textContent = label;
    button.disabled = isDisabled;
  });
}

function flashRefreshButtonsState(label) {
  setRefreshButtonsState(label, false);
  state.refreshStatusTimer = setTimeout(() => {
    getRefreshButtons_().forEach((button) => {
      if (button.id === "refreshHomeBtn") {
        const label = button.dataset.defaultLabel || "Refresh data";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.classList.remove("is-refreshing");
      } else {
        button.textContent = button.dataset.defaultLabel || "Refresh";
      }
      button.disabled = false;
    });
  }, 1200);
}

function renderLoginManagers() {
  const managers = Array.isArray(state.loginBootstrap?.managers)
    ? state.loginBootstrap.managers
    : (state.appData?.managers || []);
  loginManagerSelect.innerHTML = `<option value="">Select team</option>`;

  const teamCounts = managers.reduce((acc, m) => {
    const team = cleanTeamName(m);
    if (team) acc[team] = (acc[team] || 0) + 1;
    return acc;
  }, {});

  managers.forEach((m) => {
    const option = document.createElement("option");
    const team = cleanTeamName(m);
    option.value = m.manager;

    // Duplicate team names need manager shown, or Top Dog co-managers cannot tell which PIN belongs to which login.
    option.textContent = team
      ? (teamCounts[team] > 1 ? `${team} — ${m.manager}` : team)
      : m.manager;

    loginManagerSelect.appendChild(option);
  });

  if (state.manager) loginManagerSelect.value = state.manager;
}

function renderAuthenticatedShell() {
  const brandTitle = document.getElementById("brandTitle");
  if (brandTitle) brandTitle.textContent = state.teamName || "League HQ";

  const managerLine = document.getElementById("managerLine");
  if (managerLine) {
    managerLine.textContent = state.manager
      ? `Manager: ${state.manager}`
      : "League data connected";
  }

  updateLastUpdatedText();
}

function renderApp() {
  const data = state.appData || {};
  const settings = data.settings || {};
  const title = state.teamName || settings.appName || "2B1C FFL";

  const brandTitle = document.getElementById("brandTitle");
  if (brandTitle) brandTitle.textContent = title;

  document.getElementById("managerLine").textContent = state.manager
    ? `Manager: ${state.manager}`
    : "League data connected";

  updateLastUpdatedText();
  renderHome(settings);
  renderRules(data.rules || data.ruleSettings || []);
  renderChampions(data.champions || [], data.leagueHistory || []);
  renderThreads(data.trash || []);
  renderShitShowPreview_(data.trash || []);
  loadEspnDashboard();
}

function renderHome(settings) {
  const draftDate = settings.draftDate || "September 3, 2026";
  const draftTime = settings.draftTime || "7:00 PM";
  const draftLocation = settings.draftLocation || "TBD";
  const buyIn = settings.buyIn || "$100";
  const payouts = settings.payouts || "1st $800 / 2nd $300 / 3rd $100";

  document.getElementById("draftDateText").textContent = draftDate;
  document.getElementById("draftTimeText").textContent = draftTime;
  document.getElementById("draftLocationText").textContent = draftLocation;
  document.getElementById("buyInText").textContent = buyIn;
  document.getElementById("payoutsText").textContent = payouts;
  document.getElementById("venmoBox").innerHTML = escapeHtml(settings.venmoLabel || "Venmo QR coming soon").replace(/\n/g, "<br>");
  document.getElementById("cashAppBox").innerHTML = escapeHtml(settings.cashAppLabel || "Cash App QR coming soon").replace(/\n/g, "<br>");

  const espnBtn = document.getElementById("espnBtn");
  if (settings.espnUrl) {
    espnBtn.onclick = () => window.open(settings.espnUrl, "_blank", "noopener");
  }

  updateDraftCentralCollapse_(draftDate, draftTime);
}

function parseDraftDateTime_(dateStr, timeStr) {
  if (!dateStr) return null;

  const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;
  const combinedParsed = new Date(combined);
  if (!isNaN(combinedParsed.getTime())) return combinedParsed;

  const dateOnlyParsed = new Date(dateStr);
  return isNaN(dateOnlyParsed.getTime()) ? null : dateOnlyParsed;
}

function updateDraftCentralCollapse_(draftDate, draftTime) {
  const toggle = document.getElementById("draftSummaryToggle");
  const detailGrid = document.getElementById("draftDetailGrid");
  const note = document.getElementById("draftSettingsNote");
  if (!toggle || !detailGrid) return;

  const draftMoment = parseDraftDateTime_(draftDate, draftTime);
  const isPast = Boolean(draftMoment && draftMoment.getTime() < Date.now());

  if (!isPast) {
    toggle.classList.add("hidden");
    detailGrid.classList.remove("hidden");
    if (note) note.classList.remove("hidden");
    return;
  }

  toggle.classList.remove("hidden");
  detailGrid.classList.toggle("hidden", !state.draftCentralExpanded);
  if (note) note.classList.toggle("hidden", !state.draftCentralExpanded);

  const toggleText = toggle.querySelector(".draft-summary-toggle-text");
  if (toggleText) {
    toggleText.textContent = state.draftCentralExpanded ? "Tap to collapse" : "Tap to view details";
  }
}

function toggleDraftCentralDetail_() {
  state.draftCentralExpanded = !state.draftCentralExpanded;

  const settings = (state.appData || {}).settings || {};
  const draftDate = settings.draftDate || "September 3, 2026";
  const draftTime = settings.draftTime || "7:00 PM";
  updateDraftCentralCollapse_(draftDate, draftTime);
}

async function loadEspnDashboard() {
  if (!state.loggedIn || state.espnDashboardLoading) return;

  state.espnDashboardLoading = true;
  setScoreboardStatus("Syncing", false);
  setStandingsStatus("Syncing", false);
  setEspnSyncText("ESPN syncing...");

  const [settingsResult, standingsResult] = await Promise.allSettled([
    api("espnSettings"),
    api("espnStandings")
  ]);

  let espnSettings = {};
  const settingsOk = settingsResult.status === "fulfilled";
  if (settingsOk) {
    espnSettings = settingsResult.value || {};
    renderEspnDraftSettings(espnSettings);
  } else {
    renderEspnDraftSettingsError(settingsResult.reason || new Error("Settings failed"));
  }

  const week = Number(espnSettings.currentMatchupPeriod || espnSettings.scoringPeriodId || 1) || 1;
  state.currentWeek = week;

  const standingsOk = standingsResult.status === "fulfilled";
  if (standingsOk) {
    renderEspnStandings(standingsResult.value.standings || [], week);
  } else {
    renderEspnStandingsError(standingsResult.reason || new Error("Standings failed"));
  }

  let scoreboardOk = false;
  try {
    const scoreboardResponse = await api("espnScoreboard", { week });
    const games = getVisibleScoreboardGames_(scoreboardResponse.scoreboard || [], week);
    renderEspnScoreboard(games, week);
    renderCookinFried_(games, week);
    scoreboardOk = true;
  } catch (scoreboardError) {
    renderEspnScoreboardError(scoreboardError);
    renderCookinFriedError_(scoreboardError);
  }

  state.espnDashboardLoadedAt = new Date();

  if (settingsOk && standingsOk && scoreboardOk) {
    setEspnSyncText("ESPN synced");
  } else if (!settingsOk && !standingsOk && !scoreboardOk) {
    setEspnSyncText("ESPN sync failed");
  } else {
    setEspnSyncText("ESPN partially synced - see cards below");
  }

  state.espnDashboardLoading = false;
}

function renderEspnDraftSettings(settings) {
  const note = document.getElementById("draftSettingsNote");
  if (!note) return;

  const draft = settings.draftSettings || {};
  const draftType = String(draft.type || "Snake").replace(/_/g, " ").toLowerCase();
  const seconds = Number(draft.timePerSelection || 0);
  const timerText = seconds ? `${seconds} seconds per pick` : "draft timer not loaded";
  note.textContent = `${capitalize_(draftType)} draft - ${timerText} - ESPN settings`;
}

function renderEspnStandings(standings, week) {
  const rows = document.getElementById("standingsRows");
  if (!rows) return;

  const top = standings.slice(0, 6);
  if (!top.length) {
    rows.innerHTML = `<div><b>?</b><span>No ESPN standings loaded</span><small>Week ${week}</small></div>`;
    setStandingsStatus("No data", false);
    return;
  }

  setStandingsStatus("ESPN live", true);
  rows.innerHTML = top.map((team, index) => `
    <div class="standing-row-clickable" data-team-id="${escapeHtml(String(team.teamId || ""))}" data-team-name="${escapeHtml(team.teamName || `Team ${team.teamId || index + 1}`)}" role="button" tabindex="0">
      <b>${index + 1}</b>
      <span>${escapeHtml(team.teamName || `Team ${team.teamId || index + 1}`)}</span>
      <small>${formatRecord_(team)} - ${formatPoints_(team.pointsFor)} PF</small>
    </div>
  `).join("");
}

function renderEspnScoreboard(games, week) {
  const body = document.getElementById("scoreboardBody");
  if (!body) return;

  if (!games.length) {
    setScoreboardStatus(`Week ${week}`, true);
    body.innerHTML = `
      <p class="big-placeholder">No Week ${week} scoreboard yet.</p>
      <p class="muted">ESPN is connected. Matchups will fill once the schedule has games.</p>
    `;
    return;
  }

  setScoreboardStatus(`Week ${week}`, true);
  body.innerHTML = `
    <div class="scoreboard-list">
      ${games.map(renderScoreboardGame).join("")}
    </div>
  `;
}

function renderScoreboardGame(game) {
  return `
    <div class="score-row">
      <span class="team-name-clickable" data-team-id="${escapeHtml(String(game.awayTeamId || ""))}" data-team-name="${escapeHtml(game.awayTeamName || "Away")}" role="button" tabindex="0">${escapeHtml(game.awayTeamName || "Away")}</span>
      <strong>${formatScore_(game.awayScore)}</strong>
      <small>at</small>
      <span class="team-name-clickable" data-team-id="${escapeHtml(String(game.homeTeamId || ""))}" data-team-name="${escapeHtml(game.homeTeamName || "Home")}" role="button" tabindex="0">${escapeHtml(game.homeTeamName || "Home")}</span>
      <strong>${formatScore_(game.homeScore)}</strong>
    </div>
  `;
}

function renderEspnDraftSettingsError(error) {
  const note = document.getElementById("draftSettingsNote");
  if (note) {
    note.textContent = "Draft settings unavailable - " + (error.message || "try Refresh data.");
  }
}

function renderEspnStandingsError(error) {
  setStandingsStatus("Standings error", false);

  const rows = document.getElementById("standingsRows");
  if (rows) {
    rows.innerHTML = `<div><b>?</b><span>Standings did not load</span><small>${escapeHtml(error.message || "Try Refresh data.")}</small></div>`;
  }
}

function renderEspnScoreboardError(error) {
  setScoreboardStatus("Scoreboard error", false);

  const body = document.getElementById("scoreboardBody");
  if (body) {
    body.innerHTML = `
      <p class="big-placeholder">Scoreboard did not load.</p>
      <p class="muted">${escapeHtml(error.message || "Try Refresh data.")}</p>
    `;
  }
}

function computeWeeklyHighlights_(games) {
  if (!Array.isArray(games) || !games.length) return null;

  const teamScores = [];
  games.forEach((game) => {
    teamScores.push({ teamName: game.awayTeamName || "Away", score: Number(game.awayScore || 0) });
    teamScores.push({ teamName: game.homeTeamName || "Home", score: Number(game.homeScore || 0) });
  });

  if (!teamScores.length) return null;

  const top = teamScores.reduce((best, t) => (t.score > best.score ? t : best), teamScores[0]);
  const bottom = teamScores.reduce((worst, t) => (t.score < worst.score ? t : worst), teamScores[0]);

  let blowout = null;
  let closest = null;

  games.forEach((game) => {
    const away = Number(game.awayScore || 0);
    const home = Number(game.homeScore || 0);
    const margin = Math.abs(away - home);
    const entry = {
      margin,
      winner: away > home ? (game.awayTeamName || "Away") : (game.homeTeamName || "Home"),
      loser: away > home ? (game.homeTeamName || "Home") : (game.awayTeamName || "Away")
    };
    if (!blowout || margin > blowout.margin) blowout = entry;
    if (!closest || margin < closest.margin) closest = entry;
  });

  return { top, bottom, blowout, closest };
}

function renderCookinFried_(games, week) {
  const body = document.getElementById("cookinFriedBody");
  if (!body) return;

  const highlights = computeWeeklyHighlights_(games);
  if (!highlights) {
    body.innerHTML = `<p class="muted">No Week ${week} scores yet.</p>`;
    return;
  }

  const { top, bottom, blowout, closest } = highlights;

  body.innerHTML = `
    <div class="heat-row">
      <span class="heat-badge cookin-badge">Cookin'</span>
      <span class="heat-team">${escapeHtml(top.teamName)}</span>
      <strong>${formatScore_(top.score)}</strong>
    </div>
    <div class="heat-row">
      <span class="heat-badge fried-badge">Fried</span>
      <span class="heat-team">${escapeHtml(bottom.teamName)}</span>
      <strong>${formatScore_(bottom.score)}</strong>
    </div>
    ${blowout ? `<p class="muted compact-note">Biggest blowout: ${escapeHtml(blowout.winner)} over ${escapeHtml(blowout.loser)} by ${formatScore_(blowout.margin)}</p>` : ""}
    ${closest && !isSameGame_(closest, blowout) ? `<p class="muted compact-note">Closest game: ${escapeHtml(closest.winner)} over ${escapeHtml(closest.loser)} by ${formatScore_(closest.margin)}</p>` : ""}
  `;
}

function isSameGame_(a, b) {
  if (!a || !b) return false;
  return a.winner === b.winner && a.loser === b.loser && a.margin === b.margin;
}

function renderCookinFriedError_(error) {
  const body = document.getElementById("cookinFriedBody");
  if (body) {
    body.innerHTML = `<p class="muted">Couldn't load this week's damage - ${escapeHtml(error.message || "try Refresh data.")}</p>`;
  }
}

function renderShitShowPreview_(posts) {
  const body = document.getElementById("shitShowPreviewBody");
  if (!body) return;

  const latest = getTrashPostsNewestFirst_(posts || [])[0];
  if (!latest) {
    body.innerHTML = `<p class="muted">No trash yet. Be the first to talk shit.</p>`;
    return;
  }

  body.innerHTML = `
    <p class="shitshow-preview-line"><b>${escapeHtml(displayPoster(latest))}:</b> ${escapeHtml(latest.message || "")}</p>
    <p class="muted compact-note">${escapeHtml(latest.timestamp || "")}</p>
  `;
}

function setScoreboardStatus(text, isLive) {
  const status = document.getElementById("scoreboardStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("neutral", !isLive);
}

function setStandingsStatus(text, isLive) {
  const status = document.getElementById("standingsStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("neutral", !isLive);
}

function setEspnSyncText(text) {
  const el = document.getElementById("espnSyncText");
  if (el) el.textContent = text;
}

function getVisibleScoreboardGames_(scoreboard, week) {
  const games = Array.isArray(scoreboard) ? scoreboard : [];
  const currentWeekGames = games.filter((game) => Number(game.matchupPeriodId) === week);
  return (currentWeekGames.length ? currentWeekGames : games).slice(0, 6);
}

function formatRecord_(team) {
  return `${Number(team.wins || 0)}-${Number(team.losses || 0)}${Number(team.ties || 0) ? `-${Number(team.ties || 0)}` : ""}`;
}

function formatPoints_(points) {
  const value = Number(points || 0);
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatScore_(score) {
  const value = Number(score || 0);
  return value ? value.toFixed(1).replace(/\.0$/, "") : "0";
}

function capitalize_(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function syncLiveTeamNameFromAppData(data) {
  if (!state.manager || !Array.isArray(data?.managers)) return;

  const match = data.managers.find((m) =>
    String(m?.manager || "").trim() === String(state.manager || "").trim()
  );
  const liveTeamName = cleanTeamName(match);

  if (!liveTeamName || liveTeamName === state.teamName) return;

  state.teamName = liveTeamName;
  localStorage.setItem("teamName", state.teamName);
}

function updateLastUpdatedText() {
  const el = document.getElementById("lastUpdatedText");
  if (!el) return;

  if (!state.lastUpdatedAt) {
    el.textContent = state.appData ? "Cached data · syncing…" : "Syncing league data…";
    return;
  }

  const stamp = state.lastUpdatedAt instanceof Date
    ? state.lastUpdatedAt
    : new Date(state.lastUpdatedAt);

  if (Number.isNaN(stamp.getTime())) {
    el.textContent = "League data loaded";
    return;
  }

  el.textContent = `Updated ${stamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function renderRules(rules) {
  const section = document.getElementById("rules");
  section.innerHTML = `
    <section class="card rules-intro-card">
      <h3>Rule Review</h3>
      <p class="muted">Baseline/current ESPN settings only. Proposed changes are not final until commissioner review.</p>
    </section>
    <section class="card rule-search-card">
      <label class="mini-label" for="ruleSearchInput">Search rules</label>
      <div class="rule-search-row">
        <input id="ruleSearchInput" type="text" placeholder="kicker, waivers, playoffs, IR...">
        <button class="secondary-btn compact-btn" id="ruleSearchClearBtn" type="button">Clear</button>
      </div>
      <p id="ruleSearchStatus" class="muted compact-note hidden"></p>
    </section>
  `;

  if (!rules.length) {
    section.innerHTML += `<section class="card"><p class="muted">No rule rows loaded yet.</p></section>`;
    return;
  }

  const grouped = rules.reduce((acc, rule) => {
    const area = rule.ruleArea || rule.title || "Rules";
    if (!acc[area]) acc[area] = [];
    acc[area].push(rule);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([area, rows]) => {
    const isOpen = state.expandedRuleAreas.has(area);
    const card = document.createElement("section");
    card.className = "card rule-accordion" + (isOpen ? " open" : "");
    card.dataset.ruleArea = area;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rule-accordion-head";
    btn.innerHTML = `
      <span>
        <b>${escapeHtml(area)}</b>
      </span>
    `;
    btn.addEventListener("click", () => toggleRuleArea(area));

    const body = document.createElement("div");
    body.className = "rule-accordion-body";

    rows.forEach((rule) => {
      const setting = rule.setting || "Setting";
      const baseline = rule.baselineValue || rule.baseline || "";
      const proposed = rule.proposedValue || rule.proposed || "";
      const finalValue = rule.finalValue || "";
      const saved = rule.espnSaved || "";
      const notes = rule.notes || "";
      const status = finalValue ? "Final" : (saved || "Needs review");

      const row = document.createElement("div");
      row.className = "rule-row";
      row.dataset.search = buildSearchBlob_([area, setting, baseline, proposed, finalValue, notes, status]);
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(setting)}</strong>
          ${baseline ? `<span><b>Baseline:</b> ${escapeHtml(baseline)}</span>` : ""}
          ${proposed ? `<span><b>Proposed:</b> ${escapeHtml(proposed)}</span>` : ""}
          ${finalValue ? `<span><b>Final:</b> ${escapeHtml(finalValue)}</span>` : ""}
          ${notes ? `<em>${escapeHtml(notes)}</em>` : ""}
        </div>
        <small>${escapeHtml(status)}</small>
      `;
      body.appendChild(row);
    });

    card.appendChild(btn);
    card.appendChild(body);
    section.appendChild(card);
  });

  const searchInput = document.getElementById("ruleSearchInput");
  const clearBtn = document.getElementById("ruleSearchClearBtn");
  if (searchInput) {
    searchInput.value = state.ruleQuery;
    searchInput.addEventListener("input", () => filterRules(searchInput.value));
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.ruleQuery = "";
      if (searchInput) searchInput.value = "";
      filterRules("");
    });
  }
  filterRules(state.ruleQuery);
}

function stemWord_(word) {
  return word.replace(/(ing|ers|er|es|s)$/i, "");
}

const RULE_SEARCH_SYNONYMS = {
  rb: ["running", "back", "rush"],
  wr: ["receiver", "wide"],
  te: ["tight", "end"],
  qb: ["quarterback"],
  k: ["kick"],
  dst: ["defense", "special", "team"],
  "d/st": ["defense", "special", "team"],
  ir: ["injured", "reserve"],
  faab: ["waiver", "budget"],
  fg: ["field", "goal"]
};

function tokenMatches_(rowBlob, token) {
  if (rowBlob.includes(token)) return true;
  const alternates = RULE_SEARCH_SYNONYMS[token];
  return Boolean(alternates && alternates.some((alt) => rowBlob.includes(alt)));
}

function buildSearchBlob_(parts) {
  return parts
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(stemWord_)
    .join(" ");
}

function filterRules(query) {
  state.ruleQuery = query;
  const queryTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(stemWord_);
  const q = queryTokens.join(" ");
  const section = document.getElementById("rules");
  const status = document.getElementById("ruleSearchStatus");
  if (!section) return;

  const cards = section.querySelectorAll(".rule-accordion");
  let visibleRuleCount = 0;
  let visibleAreaCount = 0;

  cards.forEach((card) => {
    const rows = card.querySelectorAll(".rule-row");
    let cardHasMatch = false;

    rows.forEach((row) => {
      const rowBlob = row.dataset.search || "";
      const matches = queryTokens.length === 0 || queryTokens.every((token) => tokenMatches_(rowBlob, token));
      row.classList.toggle("hidden", !matches);
      if (matches) {
        cardHasMatch = true;
        visibleRuleCount += 1;
      }
    });

    card.classList.toggle("hidden", !cardHasMatch);
    card.classList.toggle("search-open", Boolean(q) && cardHasMatch);
    if (cardHasMatch) visibleAreaCount += 1;
  });

  if (!status) return;

  if (!q) {
    status.classList.add("hidden");
    status.textContent = "";
  } else if (visibleRuleCount === 0) {
    status.classList.remove("hidden");
    status.textContent = `No rules match "${query.trim()}".`;
  } else {
    status.classList.remove("hidden");
    status.textContent = `${visibleRuleCount} rule${visibleRuleCount === 1 ? "" : "s"} in ${visibleAreaCount} area${visibleAreaCount === 1 ? "" : "s"} match "${query.trim()}".`;
  }
}

function toggleRuleArea(area) {
  if (state.expandedRuleAreas.has(area)) {
    state.expandedRuleAreas.delete(area);
  } else {
    state.expandedRuleAreas.add(area);
  }

  const card = document.querySelector(`.rule-accordion[data-rule-area="${cssEscape_(area)}"]`);
  if (card) {
    card.classList.toggle("open", state.expandedRuleAreas.has(area));
  }
}

function cssEscape_(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}


function renderChampions(champions, history = []) {
  const section = document.getElementById("champs");
  section.innerHTML = `
    <section class="card champs-intro-card">
      <h3>Champions Wall</h3>
      <p class="muted">Champions by season. Click a season for final standings.</p>
    </section>
  `;

  if (!champions.length) {
    section.innerHTML += `<section class="card"><p class="muted">No champion rows loaded yet.</p></section>`;
    return;
  }

  const grid = document.createElement("section");
  grid.className = "champ-grid";

  [...champions]
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))
    .forEach((champ) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "champ-year-card";
      card.innerHTML = `
        <span class="champ-year">${escapeHtml(champ.year)}</span>
        <strong>${escapeHtml(champ.championTeam || champ.champion || "TBD")}</strong>
        <small>Manager: ${escapeHtml(champ.championManager || "TBD")}</small>
        <span class="runner-line">Runner-up: ${escapeHtml(champ.runnerUpTeam || champ.runnerUp || "TBD")}</span>
      `;
      card.addEventListener("click", () => openSeasonStandings(champ.year));
      grid.appendChild(card);
    });

  section.appendChild(grid);
}

function openSeasonStandings(season) {
  const history = state.appData?.leagueHistory || [];
  const rows = history
    .filter((row) => String(row.season) === String(season))
    .sort((a, b) => Number(a.finalRank || 999) - Number(b.finalRank || 999));

  const existing = document.getElementById("standingsModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "standingsModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(season)} final standings">
      <div class="modal-head">
        <div>
          <span class="mini-label">Final Standings</span>
          <h3>${escapeHtml(season)}</h3>
        </div>
        <button class="ghost-btn modal-close" type="button">Close</button>
      </div>
      <div class="modal-body">
        ${rows.length ? rows.map(renderStandingRow).join("") : `<p class="muted">No standings rows loaded for ${escapeHtml(season)}.</p>`}
      </div>
    </section>
  `;

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeSeasonStandings();
  });

  document.body.appendChild(modal);
  modal.querySelector(".modal-close").addEventListener("click", closeSeasonStandings);
}

function closeSeasonStandings() {
  const modal = document.getElementById("standingsModal");
  if (modal) modal.remove();
}

const NFL_TEAM_ABBREV = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
  16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
};

const ROSTER_STARTER_SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"];

function handleTeamRowClick_(event) {
  const el = event.target.closest("[data-team-id]");
  if (!el || !el.dataset.teamId) return;
  openRosterDrawer(el.dataset.teamId, el.dataset.teamName || "");
}

function handleTeamRowKeydown_(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const el = event.target.closest("[data-team-id]");
  if (!el || !el.dataset.teamId) return;
  event.preventDefault();
  openRosterDrawer(el.dataset.teamId, el.dataset.teamName || "");
}

async function openRosterDrawer(teamId, teamName) {
  if (!state.loggedIn || !teamId) return;

  const existing = document.getElementById("rosterDrawer");
  if (existing) existing.remove();

  const drawer = document.createElement("div");
  drawer.id = "rosterDrawer";
  drawer.className = "drawer-backdrop";
  drawer.innerHTML = `
    <section class="drawer-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(teamName)} roster">
      <div class="drawer-head">
        <button class="ghost-btn drawer-back" type="button" aria-label="Back">&larr;</button>
        <div class="drawer-head-title">
          <span class="mini-label">Roster</span>
          <h3>${escapeHtml(teamName || "Team")}</h3>
        </div>
        <button class="ghost-btn drawer-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-body" id="rosterDrawerBody">
        <p class="muted">Loading roster...</p>
      </div>
    </section>
  `;

  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) closeRosterDrawer();
  });

  document.body.appendChild(drawer);
  drawer.querySelector(".drawer-back").addEventListener("click", closeRosterDrawer);
  drawer.querySelector(".drawer-close").addEventListener("click", closeRosterDrawer);

  try {
    const rosterMap = await ensureRosterData_(state.currentWeek || 1);
    const entry = rosterMap[String(teamId)];
    renderRosterDrawerBody_(entry, teamName);
  } catch (error) {
    const body = document.getElementById("rosterDrawerBody");
    if (body) {
      body.innerHTML = `<p class="muted">Roster did not load - ${escapeHtml(error.message || "try again.")}</p>`;
    }
  }
}

function closeRosterDrawer() {
  const drawer = document.getElementById("rosterDrawer");
  if (drawer) drawer.remove();
}

async function ensureRosterData_(week) {
  if (state.rosterByTeamId && state.rosterWeek === week && !state.rosterLoading) {
    return state.rosterByTeamId;
  }

  if (state.rosterLoading) {
    // Simple wait loop for a load already in flight.
    while (state.rosterLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state.rosterByTeamId && state.rosterWeek === week) return state.rosterByTeamId;
  }

  state.rosterLoading = true;
  try {
    const response = await api("espnRosters", { week });
    const map = {};
    (response.rosters || []).forEach((team) => {
      map[String(team.teamId)] = team;
    });
    state.rosterByTeamId = map;
    state.rosterWeek = week;
    return map;
  } finally {
    state.rosterLoading = false;
  }
}

function renderRosterDrawerBody_(entry, fallbackTeamName) {
  const body = document.getElementById("rosterDrawerBody");
  if (!body) return;

  if (!entry || !Array.isArray(entry.roster) || !entry.roster.length) {
    body.innerHTML = `<p class="muted">No roster data loaded for ${escapeHtml(fallbackTeamName || "this team")}.</p>`;
    return;
  }

  const starters = [];
  const bench = [];
  const ir = [];

  entry.roster.forEach((player) => {
    if (player.lineupSlot === "Bench") bench.push(player);
    else if (player.lineupSlot === "IR") ir.push(player);
    else starters.push(player);
  });

  starters.sort((a, b) => {
    const aIndex = ROSTER_STARTER_SLOT_ORDER.indexOf(a.lineupSlot);
    const bIndex = ROSTER_STARTER_SLOT_ORDER.indexOf(b.lineupSlot);
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
  });

  body.innerHTML = `
    ${renderRosterGroup_("Starters", starters)}
    ${renderRosterGroup_("Bench", bench)}
    ${renderRosterGroup_("IR", ir)}
  `;
}

function renderRosterGroup_(label, players) {
  if (!players.length) return "";

  return `
    <div class="roster-group">
      <h4>${escapeHtml(label)}</h4>
      ${players.map(renderRosterPlayerRow_).join("")}
    </div>
  `;
}

function renderRosterPlayerRow_(player) {
  const nflTeam = NFL_TEAM_ABBREV[player.proTeamId] || "";
  const injury = player.injuryStatus && player.injuryStatus !== "ACTIVE" ? player.injuryStatus : "";

  return `
    <div class="roster-player-row">
      <span class="roster-slot-tag">${escapeHtml(player.lineupSlot || "")}</span>
      <div class="roster-player-info">
        <strong>${escapeHtml(player.name || "Unknown")}</strong>
        <small>${escapeHtml([nflTeam, player.defaultPosition].filter(Boolean).join(" - "))}</small>
      </div>
      ${injury ? `<span class="roster-injury-tag">${escapeHtml(injury)}</span>` : ""}
    </div>
  `;
}

function renderStandingRow(row) {
  const managerLine = row.coManager
    ? `${row.manager} / ${row.coManager}`
    : row.manager;

  return `
    <div class="modal-standing-row">
      <strong>#${escapeHtml(row.finalRank || "")} ${escapeHtml(row.teamName || "Team")}</strong>
      <span>Manager: ${escapeHtml(managerLine || "TBD")}</span>
      <small>${escapeHtml(row.record || "")}${row.playoffFinish ? ` · ${escapeHtml(row.playoffFinish)}` : ""}</small>
    </div>
  `;
}


function renderThreads(posts) {
  trashList.innerHTML = "";
  updateTrashUnreadBadge(posts);

  if (!posts.length) {
    trashList.innerHTML = `<p class="muted">No trash yet. Start a thread below.</p>`;
    return;
  }

  const threads = buildThreads(posts);

  threads.forEach((thread) => {
    const isOpen = state.expandedThreads.has(thread.root.id);
    const isReplying = state.activeReplyThreadId === thread.root.id;

    const card = document.createElement("div");
    card.className = "thread-card" + (isOpen ? " open" : "");

    const head = document.createElement("button");
    head.className = "thread-head";
    head.type = "button";
    head.innerHTML = `
      <span class="thread-title">${escapeHtml(thread.title)}</span>
      <span class="thread-meta">${thread.posts.length} post${thread.posts.length === 1 ? "" : "s"} · Latest ${escapeHtml(thread.latestLabel)}</span>
    `;
    head.addEventListener("click", () => toggleThread(thread.root.id));

    const body = document.createElement("div");
    body.className = "thread-body compact-thread-body";

    thread.posts.forEach((post) => {
      const div = document.createElement("div");
      const isReply = Boolean(post.parentId);
      div.className = "thread-post compact-post" + (isReply ? " reply-post" : " root-post");
      div.innerHTML = `
        <b>${escapeHtml(displayPoster(post))}:</b>
        <span class="post-time">${escapeHtml(post.timestamp || "")}</span>
        <span class="post-dash">—</span>
        <span class="post-message">${escapeHtml(post.message)}</span>
      `;
      body.appendChild(div);
    });

    if (isReplying) {
      body.appendChild(buildInlineReplyBox(thread));
    } else {
      const replyButton = document.createElement("button");
      replyButton.className = "secondary-btn compact-btn thread-reply-btn";
      replyButton.type = "button";
      replyButton.textContent = "Reply";
      replyButton.addEventListener("click", () => startInlineReply(thread.root.id));
      body.appendChild(replyButton);
    }

    card.appendChild(head);
    card.appendChild(body);
    trashList.appendChild(card);
  });
}

function updateTrashUnreadBadge(posts) {
  const badge = document.getElementById("trashUnreadBadge");
  if (!badge) return;

  const ordered = getTrashPostsNewestFirst_(posts);
  if (!ordered.length) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }

  if (state.currentTab === "trash" || !state.trashSeenKey) {
    markTrashSeen(posts);
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }

  const unread = countUnreadTrashPosts_(ordered);
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.classList.toggle("hidden", unread < 1);
}

function markTrashSeen(posts) {
  const latest = getTrashPostsNewestFirst_(posts)[0];
  if (!latest) return;

  state.trashSeenKey = latest._trashKey;
  try {
    localStorage.setItem(TRASH_SEEN_KEY, state.trashSeenKey);
  } catch (_) {
    // Local unread state is nice-to-have only.
  }
}

function countUnreadTrashPosts_(orderedPosts) {
  let count = 0;

  for (const post of orderedPosts) {
    if (post._trashKey === state.trashSeenKey) break;
    count += 1;
  }

  return count;
}

function getTrashPostsNewestFirst_(posts) {
  return (Array.isArray(posts) ? posts : [])
    .map((post, index) => {
      const decorated = {
        ...post,
        _sourceIndex: index,
        _timeValue: getPostTimeValue({ ...post, _sourceIndex: index })
      };
      decorated._trashKey = `${decorated._timeValue}|${decorated.id || index}|${decorated.timestamp || ""}`;
      return decorated;
    })
    .sort((a, b) => {
      if (a._timeValue !== b._timeValue) return b._timeValue - a._timeValue;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
}

function buildInlineReplyBox(thread) {
  const wrap = document.createElement("div");
  wrap.className = "inline-reply-box";
  wrap.innerHTML = `
    <label class="mini-label" for="replyText_${escapeHtml(thread.root.id)}">Reply to ${escapeHtml(thread.title)}</label>
    <textarea id="replyText_${escapeHtml(thread.root.id)}" maxlength="500" placeholder="Talk your shit..."></textarea>
    <div class="inline-reply-actions">
      <button class="primary-btn compact-btn post-reply-btn" type="button">Post Reply</button>
      <button class="secondary-btn compact-btn cancel-reply-btn" type="button">Cancel</button>
    </div>
    <p class="inline-reply-status status-line"></p>
  `;

  const textarea = wrap.querySelector("textarea");
  const postBtn = wrap.querySelector(".post-reply-btn");
  const cancelBtn = wrap.querySelector(".cancel-reply-btn");
  const status = wrap.querySelector(".inline-reply-status");

  postBtn.addEventListener("click", () => postInlineReply(thread, textarea, postBtn, cancelBtn, status));
  cancelBtn.addEventListener("click", () => {
    state.activeReplyThreadId = "";
    renderThreads(state.appData?.trash || []);
  });

  setTimeout(() => textarea.focus(), 0);
  return wrap;
}

function startInlineReply(threadId) {
  if (!threadId) return;
  state.activeReplyThreadId = threadId;
  state.expandedThreads.add(threadId);
  renderThreads(state.appData?.trash || []);
}

async function postInlineReply(thread, textarea, postBtn, cancelBtn, status) {
  const message = textarea.value.trim();

  if (!message) {
    status.textContent = "Type a reply first.";
    return;
  }

  await submitTrashMessage({
    message,
    parentId: thread.root.id,
    threadTitle: thread.title,
    status,
    buttons: [postBtn, cancelBtn],
    postingLabel: "Posting reply..."
  });

  state.activeReplyThreadId = "";
  state.expandedThreads.add(thread.root.id);
}


function buildThreads(posts) {
  const decorated = posts.map((post, index) => ({
    ...post,
    _sourceIndex: index,
    _timeValue: getPostTimeValue(post)
  }));

  const byId = new Map();
  decorated.forEach((post) => {
    if (post.id) byId.set(post.id, post);
  });

  const roots = [];
  const repliesByParent = new Map();

  decorated.forEach((post) => {
    if (post.parentId && byId.has(post.parentId)) {
      if (!repliesByParent.has(post.parentId)) repliesByParent.set(post.parentId, []);
      repliesByParent.get(post.parentId).push(post);
    } else {
      roots.push(post);
    }
  });

  const threads = roots.map((root) => {
    const replies = repliesByParent.get(root.id) || [];
    const threadPosts = [root, ...replies].sort(sortPostsOldestFirst);
    const latestPost = threadPosts[threadPosts.length - 1] || root;
    const title = root.threadTitle || root.message.slice(0, 60) || "Trash Thread";

    return {
      title,
      root,
      posts: threadPosts,
      latestTime: latestPost._timeValue,
      latestLabel: latestPost.timestamp || "recently"
    };
  });

  return threads.sort((a, b) => {
    if (a.latestTime !== b.latestTime) return b.latestTime - a.latestTime;
    return String(b.root.id || "").localeCompare(String(a.root.id || ""));
  });
}

function sortPostsOldestFirst(a, b) {
  if (a._timeValue !== b._timeValue) return a._timeValue - b._timeValue;
  return b._sourceIndex - a._sourceIndex;
}

function getPostTimeValue(post) {
  const raw = String(post.timestamp || "").trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isNaN(parsed)) return parsed;

  // Fallback: backend currently returns newest first, so reverse the source index.
  return Number.MAX_SAFE_INTEGER - (post._sourceIndex || 0);
}

function toggleThread(threadId) {
  if (!threadId) return;

  if (state.expandedThreads.has(threadId)) {
    state.expandedThreads.delete(threadId);
  } else {
    state.expandedThreads.add(threadId);
  }

  renderThreads(state.appData?.trash || []);
}

function openNewThreadForm() {
  const form = document.getElementById("newThreadForm");
  const openBtn = document.getElementById("openNewThreadBtn");
  const textarea = document.getElementById("trashMessage");

  if (!form || !openBtn) return;

  form.classList.remove("hidden");
  openBtn.classList.add("hidden");
  setTimeout(() => textarea?.focus(), 0);
}

function closeNewThreadForm() {
  const form = document.getElementById("newThreadForm");
  const openBtn = document.getElementById("openNewThreadBtn");
  const titleInput = document.getElementById("threadTitleInput");
  const textarea = document.getElementById("trashMessage");
  const status = document.getElementById("trashStatus");

  if (!form || !openBtn) return;

  form.classList.add("hidden");
  openBtn.classList.remove("hidden");

  if (titleInput) titleInput.value = "";
  if (textarea) textarea.value = "";
  if (status) status.textContent = "";
}

function setButtonBusy(buttons, isBusy, label) {
  buttons.filter(Boolean).forEach((button) => {
    if (isBusy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label || "Posting...";
      button.disabled = true;
      button.classList.add("is-busy");
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.classList.remove("is-busy");
    }
  });
}

async function postTrash() {
  const titleInput = document.getElementById("threadTitleInput");
  const textarea = document.getElementById("trashMessage");
  const button = document.getElementById("postTrashBtn");
  const status = document.getElementById("trashStatus");
  const message = textarea.value.trim();
  const threadTitle = titleInput.value.trim();

  if (!message) {
    status.textContent = "Type a message first.";
    return;
  }

  const response = await submitTrashMessage({
    message,
    parentId: "",
    threadTitle,
    status,
    buttons: [button, document.getElementById("cancelNewThreadBtn")],
    postingLabel: "Posting..."
  });

  if (response) {
    textarea.value = "";
    titleInput.value = "";
    closeNewThreadForm();
  }
}

async function submitTrashMessage({ message, parentId = "", threadTitle = "", status, buttons = [], postingLabel = "Posting..." }) {
  if (state.isPostingTrash) return false;

  state.isPostingTrash = true;
  status.textContent = postingLabel;
  setButtonBusy(buttons, true, postingLabel);

  try {
    await api("submitTrashTalk", {
      manager: state.manager,
      pin: state.pin,
      message,
      parentId,
      threadTitle
    });

    status.textContent = "Posted. Refreshing...";
    await refreshData(true);
    status.textContent = "Posted.";

    setTimeout(() => {
      if (status.textContent === "Posted.") status.textContent = "";
    }, 1400);

    return true;
  } catch (error) {
    status.textContent = "Post failed: " + error.message;
    return false;
  } finally {
    state.isPostingTrash = false;
    setButtonBusy(buttons, false);
  }
}

function cleanTeamName(m) {
  return String(m?.teamName || "").trim();
}

function displayPoster(post) {
  const team = String(post.teamName || "").trim();
  const manager = String(post.manager || "").trim();

  if (!team) return manager || "League";

  const duplicateTeam = (state.appData?.managers || [])
    .filter((m) => String(m.teamName || "").trim() === team).length > 1;

  if (duplicateTeam && manager) return `${team} (${managerInitials(manager)})`;
  return team;
}

function managerInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function showTab(id) {
  state.currentTab = id;

  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === id);
  });

  if (id === "trash") {
    markTrashSeen(state.appData?.trash || []);
    updateTrashUnreadBadge(state.appData?.trash || []);
    refreshData(true);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startAutoRefresh() {
  if (state.trashTimer) return;

  state.trashTimer = setInterval(() => {
    if (state.loggedIn && state.currentTab === "trash") {
      refreshData(true);
    }
  }, AUTO_REFRESH_MS);
}

/**
 * JSONP API helper.
 */
function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = "__fflApi_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const url = new URL(APPS_SCRIPT_API_URL);

    url.searchParams.set("api", "1");
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("API timeout"));
    }, 20000);

    window[callbackName] = (payload) => {
      cleanup();

      if (!payload || payload.ok === false) {
        reject(new Error(payload?.error || "API error"));
        return;
      }

      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach Apps Script API"));
    };

    script.src = url.toString();
    document.body.appendChild(script);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
  });
}

function randomLoadingLine() {
  const lines = [
    "Loading league drama…",
    "Counting excuses…",
    "Roster still mid…",
    "Opening trash talk…",
    "Checking bad decisions…",
    "Judging your bench…",
    "Finding your L…",
    "Warming up shit talk…",
    "Checking waiver regrets…",
    "Polishing last place…",
    "Loading weak rosters…",
    "Auditing your Ls…",
    "Summoning bad trades…",
    "Reviewing poor choices…",
    "Checking bench sadness…",
    "Loading fake confidence…",
    "Preparing excuses…",
    "Scanning draft trauma…",
    "Ranking bad takes…",
    "Finding playoff lies…",
    "Checking toilet bowl odds…",
    "Loading your weak ass roster…",
    "Lowest score doesn\u2019t win…",
    "You suck, one sec…",
    "Should\u2019ve autodrafted…",
    "Your team sucks, hang tight…",
    "Confirming you\u2019re still trash…",
    "Your GM license got revoked…",
    "Roster so bad it\u2019s illegal…",
    "Buffering your excuses…",
    "Your bye week never ends…",
    "Coaching staff quit again…",
    "Waiver wire is laughing at you…",
    "Still not a playoff team…",
    "Somehow worse than last week…"
  ];

  let lastLine = "";
  try {
    lastLine = localStorage.getItem(LAST_LOADING_LINE_KEY) || "";
  } catch (error) {}

  const choices = lines.length > 1 ? lines.filter((line) => line !== lastLine) : lines;
  const nextLine = choices[Math.floor(Math.random() * choices.length)] || lines[0];

  try {
    localStorage.setItem(LAST_LOADING_LINE_KEY, nextLine);
  } catch (error) {}

  return nextLine;
}

function setLoginBusy(isBusy, message) {
  loginScreen.classList.toggle("auto-loading", isBusy);
  loginManagerSelect.disabled = isBusy;
  loginPinInput.disabled = isBusy;
  enterBtn.disabled = isBusy;
  clearBtn.disabled = isBusy;

  if (message) setLoginStatus(message, isBusy ? "loading" : "");
}

function updateClearSavedVisibility() {
  const hasSaved = Boolean(localStorage.getItem("managerName") && localStorage.getItem("managerPin"));
  clearBtn.classList.toggle("hidden", !hasSaved);
}

function setLoginStatus(message, kind = "") {
  loginStatus.textContent = message;
  if (kind) {
    loginStatus.dataset.kind = kind;
  } else {
    delete loginStatus.dataset.kind;
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
