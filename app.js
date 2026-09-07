/*
  2B1C FFL
  v0.5.45 - flattened feed styling; Enter sends on desktop
*/
const APPS_SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbx1r1DRzTOZj9wy1NRspGRc-Nq51oypZGl6upojMG4NUGmZMH7GMCPPWBClFRl08rAtaA/exec";
const APP_DATA_CACHE_KEY = "2b1cAppDataCacheV1";
const APP_DATA_CACHE_TIME_KEY = "2b1cAppDataCacheTimeV1";
const LAST_LOADING_LINE_KEY = "2b1cLastLoadingLineV1";
const TRASH_SEEN_KEY = "2b1cTrashSeenKeyV1";
const CARD_COLLAPSE_KEY_PREFIX = "2b1cCardCollapsedV1";
const HOME_CARD_IDS = ["scoreboardCard", "standingsCard", "shitShowPreviewCard"];
const COMMISH_CARD_IDS = ["commishPollsCard", "commishManagersCard"];

const AUTO_REFRESH_MS = 25000;

const state = {
  loggedIn: false,
  manager: localStorage.getItem("managerName") || "",
  pin: localStorage.getItem("managerPin") || "",
  teamName: localStorage.getItem("teamName") || "",
  role: "",
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
  expandedRuleAreas: new Set(),
  ruleQuery: "",
  currentWeek: 1,
  rosterWeek: null,
  rosterByTeamId: null,
  rosterLoading: false,
  isPostingTrash: false,
  feedReplyToId: "",
  feedUnreadCutKey: "",
  expandedFeedMessages: new Set()
};

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginStatus = document.getElementById("loginStatus");
const loginManagerSelect = document.getElementById("loginManagerSelect");
const loginPinInput = document.getElementById("loginPinInput");
const enterBtn = document.getElementById("enterBtn");
const clearBtn = document.getElementById("clearBtn");
const feedList = document.getElementById("feedList");
const feedScroll = document.getElementById("feedScroll");

const hasSavedLogin = Boolean(state.manager && state.pin);
if (hasSavedLogin) {
  setLoginBusy(true, randomLoadingLine());
}

enterBtn.addEventListener("click", () => login(false));
clearBtn.addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("createPollBtn")?.addEventListener("click", createPoll_);
document.getElementById("closePollBtn")?.addEventListener("click", closeActivePoll_);
document.getElementById("addManagerBtn")?.addEventListener("click", addManager_);
document.getElementById("feedSendBtn")?.addEventListener("click", sendFeedMessage);
document.getElementById("feedReplyChipClear")?.addEventListener("click", clearFeedReply);
document.getElementById("refreshTrashBtn").addEventListener("click", () => refreshData(false));
setupFeedComposer_();
document.getElementById("refreshHomeBtn")?.addEventListener("click", () => refreshData(false));
document.getElementById("standingsRows")?.addEventListener("click", handleTeamRowClick_);
document.getElementById("standingsRows")?.addEventListener("keydown", handleTeamRowKeydown_);
document.getElementById("scoreboardBody")?.addEventListener("click", handleTeamRowClick_);
document.getElementById("scoreboardBody")?.addEventListener("keydown", handleTeamRowKeydown_);
document.querySelectorAll(".card-head-toggle[data-card-id]").forEach((head) => {
  head.addEventListener("click", () => toggleCardCollapse_(head.dataset.cardId));
  head.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleCardCollapse_(head.dataset.cardId);
  });
});

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
    state.role = result.role || "";
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
  state.role = "";
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
  const trashStatus = document.getElementById("feedStatus");
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
  renderCommissionerDesk_(data.activePoll || null);
  renderRules(data.rules || data.ruleSettings || []);
  renderChampions(data.champions || [], data.leagueHistory || []);
  renderFeed(data.trash || []);
  renderShitShowPreview_(data.trash || []);
  renderCommishNav_(data.activePoll || null);
  renderClosedPolls_(data.closedPolls || []);
  populateTeamSelect_();
  HOME_CARD_IDS.forEach(applyCardCollapseState_);
  COMMISH_CARD_IDS.forEach((id) => applyCardCollapseState_(id, { defaultCollapsed: true }));
  loadEspnDashboard();
}

function renderCommishNav_(activePoll) {
  const navBtn = document.getElementById("commishNavBtn");
  if (navBtn) navBtn.classList.toggle("hidden", !isCommissioner_());

  const activeBlock = document.getElementById("commishActivePollBlock");
  const createBlock = document.getElementById("commishCreatePollBlock");
  const questionEl = document.getElementById("commishActivePollQuestion");
  if (!activeBlock || !createBlock || !questionEl) return;

  if (activePoll && activePoll.id) {
    activeBlock.classList.remove("hidden");
    createBlock.classList.add("hidden");
    questionEl.textContent = activePoll.question || "";
  } else {
    activeBlock.classList.add("hidden");
    createBlock.classList.remove("hidden");
    questionEl.textContent = "";
  }
}

function renderClosedPolls_(closedPolls) {
  const block = document.getElementById("commishPastPollsBlock");
  const list = document.getElementById("commishPastPollsList");
  if (!block || !list) return;

  if (!Array.isArray(closedPolls) || !closedPolls.length) {
    block.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  block.classList.remove("hidden");
  list.innerHTML = "";

  closedPolls.forEach((poll) => {
    const options = Array.isArray(poll.options) ? poll.options : [];
    const total = options.reduce((sum, opt) => sum + (Number(opt.count) || 0), 0);

    const details = document.createElement("details");
    details.className = "past-poll-row";

    const summary = document.createElement("summary");
    summary.textContent = poll.question || "Poll";
    details.appendChild(summary);

    const resultsWrap = document.createElement("div");
    resultsWrap.className = "past-poll-results";
    options.forEach((opt) => {
      const count = Number(opt.count) || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = "past-poll-option";
      row.innerHTML = `<span>${escapeHtml(opt.label || opt.value || "")}</span><span class="muted">${pct}% · ${count} vote${count === 1 ? "" : "s"}</span>`;
      resultsWrap.appendChild(row);
    });
    details.appendChild(resultsWrap);

    list.appendChild(details);
  });
}

function populateTeamSelect_() {
  const select = document.getElementById("newManagerTeamSelect");
  if (!select) return;

  const teams = Array.from(
    new Set((state.appData?.managers || []).map((m) => m.teamName).filter(Boolean))
  ).sort();

  const current = select.value;
  select.innerHTML = `<option value="">Select team...</option>` +
    teams.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (teams.includes(current)) select.value = current;
}

async function loadManagersAdmin_() {
  if (!isCommissioner_()) return;
  const list = document.getElementById("commishManagersList");

  try {
    const res = await api("getManagersAdmin", { manager: state.manager, pin: state.pin });
    state.managersAdmin = res.data || [];
    renderCommishManagers_(state.managersAdmin);
  } catch (err) {
    if (list) list.innerHTML = `<p class="muted">Could not load manager info: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function renderCommishManagers_(managers) {
  const list = document.getElementById("commishManagersList");
  if (!list) return;

  if (!Array.isArray(managers) || !managers.length) {
    list.innerHTML = `<p class="muted">No managers found.</p>`;
    return;
  }

  list.innerHTML = "";
  managers.forEach((m) => {
    const row = document.createElement("div");
    row.className = "manager-admin-row";
    const lastLoginText = m.lastLogin ? `Last login: ${escapeHtml(m.lastLogin)}` : "Never logged in";
    row.innerHTML = `
      <div class="manager-admin-info">
        <b>${escapeHtml(m.manager)}</b>
        <span class="muted">${escapeHtml(m.teamName || "")}</span>
        <span class="manager-admin-stats">${lastLoginText} · ${m.loginCount || 0} logins · ${m.postCount || 0} posts · ${m.voteCount || 0} votes</span>
      </div>
      <input type="text" inputmode="numeric" maxlength="12" class="manager-admin-pin" value="${escapeHtml(m.pin || "")}">
      <button type="button" class="secondary-btn compact-btn manager-admin-save">Save</button>
    `;

    const input = row.querySelector(".manager-admin-pin");
    const saveBtn = row.querySelector(".manager-admin-save");
    saveBtn.addEventListener("click", () => saveManagerPin_(m.manager, input, saveBtn));
    list.appendChild(row);
  });
}

async function saveManagerPin_(targetManager, input, saveBtn) {
  const newPin = input.value.trim();
  if (!newPin) return;

  const originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    await api("updateManagerPin", { manager: state.manager, pin: state.pin, targetManager, newPin });
    saveBtn.textContent = "Saved";
    setTimeout(() => {
      saveBtn.textContent = originalLabel;
    }, 1500);
  } catch (err) {
    window.alert("Could not update PIN: " + (err.message || err));
    saveBtn.textContent = originalLabel;
  } finally {
    saveBtn.disabled = false;
  }
}

async function addManager_() {
  const teamSelect = document.getElementById("newManagerTeamSelect");
  const nameInput = document.getElementById("newManagerNameInput");
  const pinInput = document.getElementById("newManagerPinInput");
  const status = document.getElementById("managerFormStatus");
  const addBtn = document.getElementById("addManagerBtn");
  if (!teamSelect || !nameInput || !pinInput) return;

  const teamName = teamSelect.value;
  const newManagerName = nameInput.value.trim();
  const newPin = pinInput.value.trim();

  if (!teamName || !newManagerName || !newPin) {
    if (status) status.textContent = "Team, name, and PIN are all required.";
    return;
  }

  if (addBtn) addBtn.disabled = true;
  if (status) status.textContent = "Adding manager...";

  try {
    await api("addManager", { manager: state.manager, pin: state.pin, teamName, newManagerName, newPin });
    nameInput.value = "";
    pinInput.value = "";
    if (status) status.textContent = "Manager added.";
    await loadManagersAdmin_();
    await refreshData(true);
  } catch (err) {
    if (status) status.textContent = "Could not add manager: " + (err.message || err);
  } finally {
    if (addBtn) addBtn.disabled = false;
  }
}

function isCommissioner_() {
  return String(state.role || "").trim().toLowerCase() === "commissioner";
}

function cardCollapseKey_(cardId) {
  const managerKey = state.manager || "shared";
  return `${CARD_COLLAPSE_KEY_PREFIX}:${managerKey}:${cardId}`;
}

function isCardCollapsed_(cardId, defaultCollapsed) {
  try {
    const stored = localStorage.getItem(cardCollapseKey_(cardId));
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch (_) {
    // fall through to default
  }
  return Boolean(defaultCollapsed);
}

function setCardCollapsed_(cardId, collapsed) {
  try {
    localStorage.setItem(cardCollapseKey_(cardId), collapsed ? "1" : "0");
  } catch (_) {
    // Best-effort only - card just won't remember state.
  }
}

function applyCardCollapseState_(cardId, options) {
  const defaultCollapsed = (options && typeof options === "object") ? options.defaultCollapsed : false;
  const card = document.getElementById(cardId);
  const head = document.querySelector(`.card-head-toggle[data-card-id="${cssEscape_(cardId)}"]`);
  if (!card || !head) return;

  const collapsed = isCardCollapsed_(cardId, defaultCollapsed);
  card.classList.toggle("collapsed", collapsed);
  head.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function toggleCardCollapse_(cardId) {
  if (!cardId) return;
  const card = document.getElementById(cardId);
  const currentlyCollapsed = card ? card.classList.contains("collapsed") : isCardCollapsed_(cardId);
  setCardCollapsed_(cardId, !currentlyCollapsed);
  applyCardCollapseState_(cardId);
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

  updateDraftCentralStatus_(draftDate, draftTime);
}

function pollVoteKey_(pollId) {
  const managerKey = state.manager || "shared";
  return `2b1cPollVote:${managerKey}:${pollId}`;
}

function getMyPollVote_(pollId) {
  try {
    return localStorage.getItem(pollVoteKey_(pollId)) || "";
  } catch (_) {
    return "";
  }
}

function setMyPollVote_(pollId, choice) {
  try {
    localStorage.setItem(pollVoteKey_(pollId), choice);
  } catch (_) {
    // Local vote memory is nice-to-have only.
  }
}

function renderCommissionerDesk_(poll) {
  const defaultBlock = document.getElementById("commissionerDeskDefault");
  const pollBody = document.getElementById("pollBody");
  const pollStatus = document.getElementById("pollStatus");
  const titleEl = document.getElementById("commissionerDeskTitle");
  const card = document.getElementById("commissionerDeskCard");
  if (!defaultBlock || !pollBody || !pollStatus || !titleEl || !card) return;

  if (!poll || !poll.id) {
    defaultBlock.classList.remove("hidden");
    pollBody.classList.add("hidden");
    pollStatus.classList.add("hidden");
    pollBody.innerHTML = "";
    titleEl.textContent = "2026 Preseason Focus";
    moveCommissionerDeskCard_(false);
    return;
  }

  defaultBlock.classList.add("hidden");
  pollBody.classList.remove("hidden");
  pollStatus.classList.add("hidden");
  titleEl.textContent = poll.question || "Manager Poll";

  const myVote = getMyPollVote_(poll.id);
  const options = Array.isArray(poll.options) ? poll.options : [];
  const totalVotes = options.reduce((sum, opt) => sum + (Number(opt.count) || 0), 0);

  pollBody.innerHTML = "";
  options.forEach((opt) => {
    const count = Number(opt.count) || 0;
    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
    const picked = myVote && myVote === opt.value;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "poll-option-btn" + (picked ? " picked" : "");
    btn.innerHTML = `
      <span class="poll-option-fill" style="width:${pct}%"></span>
      <span class="poll-option-label">${escapeHtml(opt.label || opt.value || "")}</span>
      <span class="poll-option-count">${pct}% · ${count} vote${count === 1 ? "" : "s"}</span>
    `;
    btn.addEventListener("click", () => castPollVote_(poll.id, opt.value));
    pollBody.appendChild(btn);
  });

  moveCommissionerDeskCard_(true);
}

function moveCommissionerDeskCard_(toTop) {
  const card = document.getElementById("commissionerDeskCard");
  const grid = document.querySelector(".dashboard-grid");
  const commishSection = document.getElementById("commish");
  if (!card || !grid || !grid.parentNode || !commishSection) return;

  if (toTop) {
    // Active poll: surface the card at the top of Home.
    if (card.parentNode === grid.parentNode && card.nextElementSibling === grid) return; // already at top
    grid.parentNode.insertBefore(card, grid);
  } else {
    // No active poll: card lives in the Commish tab by default.
    if (card.parentNode === commishSection && commishSection.firstElementChild === card) return; // already in place
    commishSection.insertBefore(card, commishSection.firstElementChild);
  }
}

async function castPollVote_(pollId, choice) {
  if (!pollId || !choice) return;

  // Optimistic UI: adjust the tally shown right now (move my prior vote's
  // count off, add it to the new choice) so the tap feels instant, then
  // reconcile with the server's real tally.
  const poll = state.appData?.activePoll;
  const priorChoice = getMyPollVote_(pollId);
  if (poll && poll.id === pollId && Array.isArray(poll.options)) {
    poll.options.forEach((opt) => {
      if (opt.value === priorChoice && priorChoice !== choice) opt.count = Math.max(0, (Number(opt.count) || 0) - 1);
      if (opt.value === choice && priorChoice !== choice) opt.count = (Number(opt.count) || 0) + 1;
    });
    setMyPollVote_(pollId, choice);
    renderCommissionerDesk_(poll);
  } else {
    setMyPollVote_(pollId, choice);
  }

  try {
    await api("castPollVote", { manager: state.manager, pin: state.pin, pollId, choice });
    await refreshData(true);
  } catch (err) {
    window.alert("Could not cast vote: " + (err.message || err));
    await refreshData(true);
  }
}

async function createPoll_() {
  const status = document.getElementById("pollFormStatus");
  const questionInput = document.getElementById("pollQuestionInput");
  const opt1Input = document.getElementById("pollOption1Input");
  const opt2Input = document.getElementById("pollOption2Input");
  const opt3Input = document.getElementById("pollOption3Input");
  const opt4Input = document.getElementById("pollOption4Input");
  const createBtn = document.getElementById("createPollBtn");
  if (!questionInput || !opt1Input || !opt2Input) return;

  const question = questionInput.value.trim();
  const option1 = opt1Input.value.trim();
  const option2 = opt2Input.value.trim();
  const option3 = opt3Input.value.trim();
  const option4 = opt4Input.value.trim();

  if (!question || !option1 || !option2) {
    if (status) status.textContent = "Question and at least 2 options are required.";
    return;
  }

  if (createBtn) createBtn.disabled = true;
  if (status) status.textContent = "Creating poll...";

  try {
    await api("createPoll", {
      manager: state.manager,
      pin: state.pin,
      question,
      option1,
      option2,
      option3,
      option4
    });

    questionInput.value = "";
    opt1Input.value = "";
    opt2Input.value = "";
    opt3Input.value = "";
    opt4Input.value = "";
    if (status) status.textContent = "Poll created and live on Home.";
    await refreshData(true);
  } catch (err) {
    if (status) status.textContent = "Could not create poll: " + (err.message || err);
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

async function closeActivePoll_() {
  const poll = state.appData?.activePoll;
  if (!poll || !poll.id) return;

  const confirmed = window.confirm("Close this poll? It will move off Home and stop accepting votes.");
  if (!confirmed) return;

  const closeBtn = document.getElementById("closePollBtn");
  if (closeBtn) closeBtn.disabled = true;

  try {
    await api("closePoll", { manager: state.manager, pin: state.pin, pollId: poll.id });
    await refreshData(true);
  } catch (err) {
    window.alert("Could not close poll: " + (err.message || err));
  } finally {
    if (closeBtn) closeBtn.disabled = false;
  }
}

function parseDraftDateTime_(dateStr, timeStr) {
  if (!dateStr) return null;

  const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;
  const combinedParsed = new Date(combined);
  if (!isNaN(combinedParsed.getTime())) return combinedParsed;

  const dateOnlyParsed = new Date(dateStr);
  return isNaN(dateOnlyParsed.getTime()) ? null : dateOnlyParsed;
}

function updateDraftCentralStatus_(draftDate, draftTime) {
  const chip = document.getElementById("draftStatusChip");
  const draftMoment = parseDraftDateTime_(draftDate, draftTime);
  const isPast = Boolean(draftMoment && draftMoment.getTime() < Date.now());

  if (chip) chip.classList.toggle("hidden", !isPast);

  applyCardCollapseState_("draftCentralCard", { defaultCollapsed: isPast });
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

  const top = standings.slice(0, 12);
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
  });

  return { top, bottom, blowout };
}

const HEAT_ICONS = {
  flame: `<svg class="heat-icon" viewBox="0 0 24 26" width="22" height="24" aria-hidden="true">
    <path d="M13.4 1.2c.9 3.3-.6 5-2.3 6.6-2 1.9-4.6 3.5-4.6 7.4a7.6 7.6 0 0 0 15.2 0c0-2.6-1.1-4.6-2.4-6.2-.3 1.4-1.1 2.3-2.3 2.7 1-3.4-1.1-8.1-3.6-10.5Z" fill="var(--heat-hot)"/>
    <path d="M4.9 9.4c-.6 1.9-1.6 2.7-1.6 4.6a3.4 3.4 0 0 0 3.6 3.4c-1.3-2.3-1.5-5.3-2-8Z" fill="var(--heat-hot)" fill-opacity=".6"/>
    <path d="M12.6 12.9c1.3 1.7 2.1 2.7 2.1 4.3a2.9 2.9 0 1 1-5.8 0c0-1.8 2.1-2.7 3.7-4.3Z" fill="var(--heat-hot-2)"/>
  </svg>`,
  toilet: `<svg class="heat-icon" viewBox="0 0 24 26" width="22" height="24" aria-hidden="true">
    <rect x="2.4" y="2.2" width="7.6" height="9.4" rx="1.4" fill="var(--heat-cold)" fill-opacity=".55"/>
    <path d="M9.2 10.4h11.4c.6 0 1 .5.9 1.1l-.5 2.6c-.5 2.6-2.6 4.5-5.2 4.5h-2.3c-2.6 0-4.7-1.9-5.2-4.5l-.5-2.6c-.1-.6.3-1.1.9-1.1Z" fill="var(--heat-cold)"/>
    <ellipse cx="14.9" cy="12.3" rx="3.8" ry="1.4" fill="var(--panel)"/>
    <path d="M12.6 18.6h4.6l1.5 4.8H11l1.6-4.8Z" fill="var(--heat-cold)" fill-opacity=".55"/>
  </svg>`,
  helmet: `<svg class="heat-icon" viewBox="0 0 26 26" width="23" height="23" aria-hidden="true">
    <path d="M4.4 6.1 8 3.4l4.2 2.4 3.8-2.1 1.2 3.4" fill="none"
          stroke="var(--heat-pop)" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".65"/>
    <path d="M3.6 19.2c-.6-6.4 3-10.4 8.6-10.4s9.1 3.9 8.6 10.4H3.6Z" fill="var(--heat-pop)"/>
    <path d="M6.2 19.2h13.6v2.1c0 .6-.5 1-1 1H7.2c-.6 0-1-.4-1-1v-2.1Z"
          fill="var(--heat-pop)" fill-opacity=".55"/>
  </svg>`
};

function renderCookinFried_(games, week) {
  const body = document.getElementById("cookinFriedBody");
  if (!body) return;

  const highlights = computeWeeklyHighlights_(games);
  if (!highlights) {
    body.innerHTML = `<p class="muted">No Week ${week} scores yet.</p>`;
    return;
  }

  const { top, bottom, blowout } = highlights;

  body.innerHTML = `
    <div class="heat-row">
      ${HEAT_ICONS.flame}
      <span class="heat-team">${escapeHtml(top.teamName)}</span>
      <strong class="heat-value">${formatScore_(top.score)}</strong>
    </div>
    <div class="heat-row">
      ${HEAT_ICONS.toilet}
      <span class="heat-team">${escapeHtml(bottom.teamName)}</span>
      <strong class="heat-value">${formatScore_(bottom.score)}</strong>
    </div>
    ${blowout ? `
    <div class="heat-row">
      ${HEAT_ICONS.helmet}
      <span class="heat-team">${escapeHtml(blowout.winner)} over ${escapeHtml(blowout.loser)}</span>
      <strong class="heat-value">+${formatScore_(blowout.margin)}</strong>
    </div>` : ""}
  `;
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
    <section class="rule-search-card">
      <div class="rule-search-bar">
        <span class="rule-search-icon" aria-hidden="true">⌕</span>
        <input id="ruleSearchInput" type="text" placeholder="Search rules - kicker, waivers, playoffs, IR..." aria-label="Search rules">
        <button class="rule-search-clear-btn hidden" id="ruleSearchClearBtn" type="button" aria-label="Clear search">✕</button>
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
    searchInput.addEventListener("input", () => {
      filterRules(searchInput.value);
      if (clearBtn) clearBtn.classList.toggle("hidden", !searchInput.value);
    });
  }
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", !state.ruleQuery);
    clearBtn.addEventListener("click", () => {
      state.ruleQuery = "";
      if (searchInput) searchInput.value = "";
      clearBtn.classList.add("hidden");
      filterRules("");
    });
  }
  filterRules(state.ruleQuery);
}

function stemWord_(word) {
  return word.replace(/(ing|ers|er|es|s)$/i, "");
}

function normalizeSearchToken_(word) {
  return word.replace(/['’]/g, "").replace(/[\/\-]/g, "");
}

const RULE_SEARCH_SYNONYMS = {
  rb: ["running", "back", "rush"],
  wr: ["receiver", "wide"],
  te: ["tight", "end"],
  qb: ["quarterback"],
  k: ["kick"],
  dst: ["defense", "special", "team"],
  ir: ["injured", "reserve"],
  faab: ["waiver", "budget"],
  fg: ["field", "goal"]
};

function blobHasWordStartingWith_(blob, term) {
  return Boolean(term) && blob.includes(` ${term}`);
}

function tokenMatches_(rowBlob, token) {
  if (blobHasWordStartingWith_(rowBlob, token)) return true;
  const alternates = RULE_SEARCH_SYNONYMS[token];
  return Boolean(alternates && alternates.some((alt) => blobHasWordStartingWith_(rowBlob, stemWord_(alt))));
}

function buildSearchBlob_(parts) {
  const words = parts
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeSearchToken_)
    .map(stemWord_);
  return ` ${words.join(" ")} `;
}

function filterRules(query) {
  state.ruleQuery = query;
  const queryTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeSearchToken_)
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
        <div class="drawer-head-contacts">${renderTeamContacts_(teamName)}</div>
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

const INJURY_SHORTCODES = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  INJURY_RESERVE: "IR",
  INJURED_RESERVE: "IR",
  SUSPENSION: "SUS",
  PROBABLE: "P"
};

function injuryShortcode_(status) {
  const raw = String(status || "").trim().toUpperCase();
  if (!raw || raw === "ACTIVE" || raw === "NORMAL") return "";
  return INJURY_SHORTCODES[raw] || raw.slice(0, 2);
}

function renderRosterPlayerRow_(player) {
  const nflTeam = NFL_TEAM_ABBREV[player.proTeamId] || "";
  const injury = injuryShortcode_(player.injuryStatus);

  return `
    <div class="roster-player-row">
      <span class="roster-slot-tag">${escapeHtml(player.lineupSlot || "")}</span>
      <span class="roster-player-name">${escapeHtml(player.name || "Unknown")}</span>
      <span class="roster-player-team">${escapeHtml(nflTeam)}</span>
      ${injury ? `<span class="roster-injury-tag">${escapeHtml(injury)}</span>` : ""}
    </div>
  `;
}

/**
 * Managers on this team, with a tappable number when one is on file. The tel:
 * protocol is never shown - just "Name · number".
 */
function renderTeamContacts_(teamName) {
  const clean = String(teamName || "").trim().toLowerCase();
  if (!clean) return "";

  const managers = (state.appData?.managers || []).filter(
    (m) => String(m.teamName || "").trim().toLowerCase() === clean
  );

  if (!managers.length) return "";

  return managers
    .map((m) => {
      const name = escapeHtml(String(m.manager || "").trim());
      const phone = String(m.phone || "").trim();
      if (!name) return "";
      if (!phone) return `<span class="team-contact">${name}</span>`;

      return `<span class="team-contact">${name} · <a class="team-contact-phone" href="tel:${escapeHtml(
        phone.replace(/[^\d+]/g, "")
      )}">${escapeHtml(phone)}</a></span>`;
    })
    .filter(Boolean)
    .join("");
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


const FEED_TRUNCATE_AT = 180;
const FEED_QUOTE_TRUNCATE_AT = 90;

function truncateForQuote_(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= FEED_QUOTE_TRUNCATE_AT) return clean;
  return clean.slice(0, FEED_QUOTE_TRUNCATE_AT).trimEnd() + "…";
}

/**
 * Chat-style timestamps: just the time for today, add the date for older
 * messages, add the year once it is a different one. Falls back to whatever
 * the backend sent if it cannot be parsed.
 */
function formatFeedTime_(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return text;

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  const time = parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;

  const dateOpts = { month: "short", day: "numeric" };
  if (parsed.getFullYear() !== now.getFullYear()) dateOpts.year = "numeric";

  return `${parsed.toLocaleDateString([], dateOpts)}, ${time}`;
}

function renderFeed(posts) {
  if (!feedList) return;

  const wasAtBottom = isFeedAtBottom_();
  updateTrashUnreadBadge(posts);
  renderFeedPinned_(posts);

  feedList.innerHTML = "";

  const ordered = getFeedMessagesOldestFirst_(posts);
  if (!ordered.length) {
    feedList.innerHTML = `<p class="muted feed-empty">No trash yet. Be the first to talk shit.</p>`;
    return;
  }

  const byId = new Map();
  ordered.forEach((post) => {
    if (post.id) byId.set(post.id, post);
  });

  // "N new since last visit" divider: the cut is frozen when the tab opens so
  // the line does not jump around while reading.
  const cutIndex = getFeedUnreadCutIndex_(ordered);

  ordered.forEach((post, index) => {
    if (index === cutIndex) {
      const unreadCount = ordered.slice(cutIndex).filter((p) => !isMyPost_(p)).length;
      const divider = document.createElement("div");
      divider.className = "feed-new-divider";
      divider.innerHTML = `<span>${unreadCount} new since last visit</span>`;
      feedList.appendChild(divider);
    }

    feedList.appendChild(buildFeedRow_(post, byId));
  });

  if (wasAtBottom) scrollFeedToBottom_(false);
}

function buildFeedRow_(post, byId) {
  const row = document.createElement("div");
  const isMine = String(post.manager || "").trim() === String(state.manager || "").trim();
  row.className =
    "feed-row" +
    (isMine ? " mine" : "") +
    (post.pinned ? " pinned" : "") +
    (post._pending ? " pending" : "");
  if (post.id) row.dataset.messageId = post.id;

  const message = String(post.message || "");
  const isExpanded = state.expandedFeedMessages.has(post.id);
  const needsTruncation = message.length > FEED_TRUNCATE_AT;
  const shown = needsTruncation && !isExpanded ? message.slice(0, FEED_TRUNCATE_AT).trimEnd() + "…" : message;

  // A reply carries a short quote of what it is answering, so a two-word
  // comeback still makes sense on its own.
  const parent = post.parentId ? byId.get(post.parentId) : null;
  const quoteBlock = parent
    ? `<button class="feed-quote" type="button" data-jump-to="${escapeHtml(parent.id)}">
         <span class="feed-quote-author">${escapeHtml(displayPoster(parent))}</span>
         <span class="feed-quote-text">${escapeHtml(truncateForQuote_(parent.message))}</span>
       </button>`
    : "";

  row.innerHTML = `
    <div class="feed-row-main">
      <span class="feed-avatar" aria-hidden="true">${escapeHtml(getInitials_(post))}</span>
      <div class="feed-bubble">
        <div class="feed-meta">
          <b>${escapeHtml(displayPoster(post))}</b>
          <span class="feed-time">${escapeHtml(formatFeedTime_(post.timestamp))}</span>
          ${post.pinned ? `<span class="feed-pin-tag">Pinned</span>` : ""}
        </div>
        ${quoteBlock}
        <p class="feed-message">${escapeHtml(shown)}</p>
        ${needsTruncation ? `<button class="feed-more-btn" type="button">${isExpanded ? "Show less" : "More"}</button>` : ""}
      </div>
    </div>
  `;

  const jumpBtn = row.querySelector(".feed-quote");
  if (jumpBtn) {
    jumpBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      jumpToFeedMessage_(jumpBtn.dataset.jumpTo);
    });
  }

  const moreBtn = row.querySelector(".feed-more-btn");
  if (moreBtn) {
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.expandedFeedMessages.has(post.id)) state.expandedFeedMessages.delete(post.id);
      else state.expandedFeedMessages.add(post.id);
      renderFeed(state.appData?.trash || []);
    });
  }

  // Tapping the message itself starts a reply to it.
  row.querySelector(".feed-bubble")?.addEventListener("click", () => startFeedReply_(post));

  // A message still in flight has no real id yet, so it cannot be pinned,
  // hidden, or replied to until the server confirms it.
  if (isCommissioner_() && post.id && !post._pending) {
    const actions = document.createElement("div");
    actions.className = "feed-admin-actions";

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "feed-admin-btn";
    pinBtn.textContent = post.pinned ? "Unpin" : "Pin";
    pinBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      pinFeedPost_(post.id, !post.pinned);
    });

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "feed-admin-btn danger";
    hideBtn.textContent = "Hide";
    hideBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmHideTrashPost_(post.id);
    });

    actions.appendChild(pinBtn);
    actions.appendChild(hideBtn);
    row.appendChild(actions);
  }

  return row;
}

function renderFeedPinned_(posts) {
  const wrap = document.getElementById("feedPinned");
  if (!wrap) return;

  const pinned = (Array.isArray(posts) ? posts : []).filter((post) => post.pinned);
  if (!pinned.length) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }

  wrap.classList.remove("hidden");
  wrap.innerHTML = pinned
    .map(
      (post) => `
        <button class="feed-pinned-item" type="button" data-jump-to="${escapeHtml(post.id)}">
          <span class="feed-pin-icon" aria-hidden="true">📌</span>
          <span class="feed-pinned-text"><b>${escapeHtml(displayPoster(post))}:</b> ${escapeHtml(post.message || "")}</span>
        </button>
      `
    )
    .join("");

  wrap.querySelectorAll(".feed-pinned-item").forEach((item) => {
    item.addEventListener("click", () => jumpToFeedMessage_(item.dataset.jumpTo));
  });
}

function getFeedMessagesOldestFirst_(posts) {
  return getTrashPostsNewestFirst_(posts).slice().reverse();
}

function getFeedUnreadCutIndex_(ordered) {
  if (!state.feedUnreadCutKey) return -1;

  const index = ordered.findIndex((post) => post._trashKey === state.feedUnreadCutKey);
  // The cut sits directly after the last message that had already been seen.
  if (index < 0 || index === ordered.length - 1) return -1;

  const cut = index + 1;

  // Only somebody else's message counts as "new". If everything after the cut
  // is your own, there is nothing to mark.
  const hasOtherPeoplesMessages = ordered.slice(cut).some((post) => !isMyPost_(post));
  return hasOtherPeoplesMessages ? cut : -1;
}

function jumpToFeedMessage_(messageId) {
  if (!messageId) return;
  const target = feedList?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("feed-row-flash");
  setTimeout(() => target.classList.remove("feed-row-flash"), 1200);
}

function isFeedAtBottom_() {
  if (!feedScroll) return true;
  const slack = 80;
  return feedScroll.scrollHeight - feedScroll.scrollTop - feedScroll.clientHeight < slack;
}

function scrollFeedToBottom_(smooth) {
  if (!feedScroll) return;
  feedScroll.scrollTo({ top: feedScroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function getInitials_(post) {
  const source = String(post.manager || post.teamName || "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function startFeedReply_(post) {
  if (!post || !post.id || post._pending) return;

  state.feedReplyToId = post.id;

  const chip = document.getElementById("feedReplyChip");
  const chipText = document.getElementById("feedReplyChipText");
  if (chip && chipText) {
    chipText.textContent = `↩ Replying to ${displayPoster(post)}`;
    chip.classList.remove("hidden");
  }

  document.getElementById("feedInput")?.focus();
}

function clearFeedReply() {
  state.feedReplyToId = "";
  document.getElementById("feedReplyChip")?.classList.add("hidden");
}

function setupFeedComposer_() {
  const input = document.getElementById("feedInput");
  if (!input) return;

  // Auto-grow from one line up to roughly four before it starts scrolling.
  const grow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 108) + "px";
  };

  input.addEventListener("input", grow);

  // Enter sends on a real keyboard; Shift+Enter still breaks the line. Phones
  // and tablets keep the Send button - their Return key must stay a newline.
  const hasRealKeyboard = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (hasRealKeyboard) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      sendFeedMessage();
    });
  }

  input.addEventListener("focus", () => {
    // On mobile the keyboard opening shrinks the viewport; give it a beat and
    // then make sure the newest message is still in view.
    setTimeout(() => scrollFeedToBottom_(false), 250);
  });
}

async function pinFeedPost_(postId, shouldPin) {
  if (!postId) return;

  try {
    await api("pinTrashPost", {
      manager: state.manager,
      pin: state.pin,
      id: postId,
      pinned: shouldPin ? "TRUE" : "FALSE"
    });
    await refreshData(true);
  } catch (err) {
    window.alert("Could not update pin: " + (err.message || err));
    await refreshData(true);
  }
}

function confirmHideTrashPost_(postId) {
  if (!postId) return;
  const confirmed = window.confirm("Hide this message? This can't be undone from the app.");
  if (!confirmed) return;
  hideTrashPost_(postId);
}

async function hideTrashPost_(postId) {
  // Optimistic UI: drop this one message immediately so the tap feels instant,
  // then reconcile with the server. Hide is per-message only - replies to a
  // hidden message stay in the feed.
  const before = state.appData?.trash || [];
  const optimistic = before.filter((p) => p.id !== postId);

  if (state.appData) state.appData.trash = optimistic;
  renderFeed(optimistic);
  renderShitShowPreview_(optimistic);

  try {
    await api("hideTrashPost", { manager: state.manager, pin: state.pin, id: postId });
    await refreshData(true);
  } catch (err) {
    window.alert("Could not hide message: " + (err.message || err));
    await refreshData(true);
  }
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
  // Never anchor "seen" to a message still in flight - its temporary id
  // disappears once the server confirms it, which would strand the marker.
  const latest = getTrashPostsNewestFirst_(posts).find((post) => !post._pending);
  if (!latest) return;

  state.trashSeenKey = latest._trashKey;
  try {
    localStorage.setItem(TRASH_SEEN_KEY, state.trashSeenKey);
  } catch (_) {
    // Local unread state is nice-to-have only.
  }
}

function isMyPost_(post) {
  const mine = String(state.manager || "").trim();
  if (!mine) return false;
  return String(post?.manager || "").trim() === mine;
}

function countUnreadTrashPosts_(orderedPosts) {
  let count = 0;

  for (const post of orderedPosts) {
    if (post._trashKey === state.trashSeenKey) break;
    // Your own messages are never "unread" - you just wrote them.
    if (!isMyPost_(post)) count += 1;
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

function getPostTimeValue(post) {
  const raw = String(post.timestamp || "").trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isNaN(parsed)) return parsed;

  // Fallback: backend currently returns newest first, so reverse the source index.
  return Number.MAX_SAFE_INTEGER - (post._sourceIndex || 0);
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

async function sendFeedMessage() {
  const input = document.getElementById("feedInput");
  const status = document.getElementById("feedStatus");
  if (!input || !status) return;

  const message = input.value.trim();
  if (!message) {
    status.textContent = "Type something first.";
    return;
  }
  if (state.isPostingTrash) return;

  const parentId = state.feedReplyToId || "";

  // Clear the composer and drop the message into the feed right away. Waiting
  // on the round trip made shit talking feel sluggish.
  input.value = "";
  input.style.height = "auto";
  clearFeedReply();

  const pending = {
    id: "pending_" + Date.now(),
    timestamp: new Date().toString(),
    manager: state.manager,
    teamName: state.teamName,
    message,
    parentId,
    threadTitle: "",
    pinned: false,
    _pending: true
  };

  // The backend hands back newest-first, so a new message goes on the front.
  const withPending = [pending].concat(state.appData?.trash || []);
  if (state.appData) state.appData.trash = withPending;

  markTrashSeen(withPending);
  state.feedUnreadCutKey = state.trashSeenKey;
  renderFeed(withPending);
  renderShitShowPreview_(withPending);
  scrollFeedToBottom_(true);

  await submitTrashMessage({ message, parentId, status, pendingId: pending.id });
}

async function submitTrashMessage({ message, parentId = "", status, pendingId = "" }) {
  state.isPostingTrash = true;

  try {
    await api("submitTrashTalk", {
      manager: state.manager,
      pin: state.pin,
      message,
      parentId,
      threadTitle: ""
    });

    // Reconcile quietly - the real row replaces the pending one.
    await refreshData(true);
    if (status) status.textContent = "";
    return true;
  } catch (error) {
    // Pull the failed message back out of the feed and say so.
    if (state.appData && pendingId) {
      state.appData.trash = (state.appData.trash || []).filter((p) => p.id !== pendingId);
      renderFeed(state.appData.trash);
      renderShitShowPreview_(state.appData.trash);
    }
    if (status) status.textContent = "Send failed: " + error.message;
    return false;
  } finally {
    state.isPostingTrash = false;
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
    // Freeze where the "new since last visit" line sits before marking
    // everything read, so the divider stays put while reading.
    state.feedUnreadCutKey = state.trashSeenKey;
    markTrashSeen(state.appData?.trash || []);
    renderFeed(state.appData?.trash || []);
    updateTrashUnreadBadge(state.appData?.trash || []);
    // Let the tab finish becoming visible before measuring scroll height.
    setTimeout(() => scrollFeedToBottom_(false), 0);
    refreshData(true);
  }

  if (id === "commish") {
    loadManagersAdmin_();
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
