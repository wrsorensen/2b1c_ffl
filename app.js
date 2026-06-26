/*
  2B1C FFL
  v0.3.8 — simplify accordions and new thread flow
*/
const APPS_SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbx1r1DRzTOZj9wy1NRspGRc-Nq51oypZGl6upojMG4NUGmZMH7GMCPPWBClFRl08rAtaA/exec";

const AUTO_REFRESH_MS = 25000;

const state = {
  loggedIn: false,
  manager: localStorage.getItem("managerName") || "",
  pin: localStorage.getItem("managerPin") || "",
  teamName: localStorage.getItem("teamName") || "",
  currentTab: "home",
  appData: null,
  trashTimer: null,
  expandedThreads: new Set(),
  expandedRuleAreas: new Set(),
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
const trashList = document.getElementById("trashList");

const hasSavedLogin = Boolean(state.manager && state.pin);
if (hasSavedLogin) {
  loginScreen.classList.add("auto-loading");
  setLoginStatus(randomLoadingLine());
}

document.getElementById("enterBtn").addEventListener("click", () => login(false));
document.getElementById("clearBtn").addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("openNewThreadBtn")?.addEventListener("click", openNewThreadForm);
document.getElementById("cancelNewThreadBtn")?.addEventListener("click", closeNewThreadForm);
document.getElementById("postTrashBtn").addEventListener("click", postTrash);
document.getElementById("refreshTrashBtn").addEventListener("click", () => refreshData(false));

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
  try {
    if (hasSavedLogin) {
      setLoginStatus(randomLoadingLine());
    } else {
      setLoginStatus("Loading teams…");
    }

    await loadData();
    renderLoginManagers();

    if (hasSavedLogin) {
      setLoginStatus(randomLoadingLine());
      await login(true);
      return;
    }

    setLoginStatus("Ready. Pick your team and enter PIN.");
  } catch (error) {
    loginScreen.classList.remove("auto-loading");
    setLoginStatus("Startup failed: " + error.message);
  }
}

async function login(isAutoLogin = false) {
  const manager = isAutoLogin ? state.manager : loginManagerSelect.value;
  const pin = isAutoLogin ? state.pin : loginPinInput.value.trim();

  if (!manager || !pin) {
    setLoginStatus("Select team and enter PIN.");
    return;
  }

  setLoginStatus(isAutoLogin ? randomLoadingLine() : "Checking team PIN...");

  try {
    const response = await api("managerLogin", { manager, pin });
    const result = response.data || {};

    if (!result.ok) {
      if (isAutoLogin) {
        clearSaved(false);
        loginScreen.classList.remove("auto-loading");
        setLoginStatus("Saved login expired. Login again.");
      } else {
        setLoginStatus(result.message || "Invalid manager/PIN combo.");
      }
      return;
    }

    state.loggedIn = true;
    state.manager = result.manager || manager;
    state.teamName = result.teamName || "";
    state.pin = pin;

    localStorage.setItem("managerName", state.manager);
    localStorage.setItem("managerPin", state.pin);
    localStorage.setItem("teamName", state.teamName);

    loginScreen.classList.add("hidden");
    loginScreen.classList.remove("auto-loading");
    appScreen.classList.remove("hidden");

    renderApp();
    startAutoRefresh();
  } catch (error) {
    loginScreen.classList.remove("auto-loading");
    setLoginStatus("Login failed: " + error.message);
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
  loginScreen.classList.remove("auto-loading");
  if (showStatus) setLoginStatus("Saved login cleared.");
}

function logout() {
  clearSaved(false);
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderLoginManagers();
  setLoginStatus("Logged out. Select team and enter PIN.");
}

async function loadData() {
  const response = await api("getAppData");
  state.appData = response.data || {};
}

async function refreshData(silent = false) {
  if (!state.loggedIn) return;

  const trashStatus = document.getElementById("trashStatus");
  if (!silent && trashStatus) trashStatus.textContent = "Refreshing...";

  try {
    await loadData();
    renderApp();
    if (!silent && trashStatus) trashStatus.textContent = "Updated.";
    if (!silent && trashStatus) {
      setTimeout(() => {
        if (trashStatus.textContent === "Updated.") trashStatus.textContent = "";
      }, 1200);
    }
  } catch (error) {
    if (trashStatus) trashStatus.textContent = "Refresh failed: " + error.message;
  }
}

function renderLoginManagers() {
  const managers = state.appData?.managers || [];
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

function renderApp() {
  const data = state.appData || {};
  const settings = data.settings || {};
  const title = state.teamName || settings.appName || "2B1C FFL";

  const brandTitle = document.getElementById("brandTitle");
  if (brandTitle) brandTitle.textContent = title;

  document.getElementById("managerLine").textContent = state.manager
    ? `Manager: ${state.manager}`
    : "League data connected";

  renderHome(settings);
  renderRules(data.rules || data.ruleSettings || []);
  renderChampions(data.champions || [], data.leagueHistory || []);
  renderThreads(data.trash || []);
}

function renderHome(settings) {
  const draftDate = settings.draftDate || "September 3, 2026";
  const draftTime = settings.draftTime || "7:00 PM";
  const draftLocation = settings.draftLocation || "TBD";
  const buyIn = settings.buyIn || "$100";
  const payouts = settings.payouts || "1st $800 / 2nd $300 / 3rd $100";

  document.getElementById("draftDateStat").textContent = draftDate.replace("September", "Sept.").replace(", 2026", "");
  document.getElementById("buyInStat").textContent = buyIn;
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
}

function renderRules(rules) {
  const section = document.getElementById("rules");
  section.innerHTML = `
    <section class="card rules-intro-card">
      <h3>Rule Review</h3>
      <p class="muted">Baseline/current ESPN settings only. Proposed changes are not final until commissioner review.</p>
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
}

function toggleRuleArea(area) {
  if (state.expandedRuleAreas.has(area)) {
    state.expandedRuleAreas.delete(area);
  } else {
    state.expandedRuleAreas.add(area);
  }

  renderRules(state.appData?.rules || state.appData?.ruleSettings || []);
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

  if (id === "trash") refreshData(true);

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
    "Your team is shit. Why are you here?",
    "Loading league drama…",
    "Checking if your roster still has a pulse…",
    "Counting excuses before kickoff…",
    "Opening the trash board…",
    "Verifying manager. Judging roster silently…",
    "Loading 2B1C business…"
  ];

  return lines[Math.floor(Math.random() * lines.length)];
}

function setLoginStatus(message) {
  loginStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
