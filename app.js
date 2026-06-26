/*
  2B1C FFL
  v0.3.4 — frontend UX polish
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
  replyingToId: "",
  replyingToTitle: ""
};

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginStatus = document.getElementById("loginStatus");
const loginManagerSelect = document.getElementById("loginManagerSelect");
const loginPinInput = document.getElementById("loginPinInput");
const trashList = document.getElementById("trashList");

document.getElementById("enterBtn").addEventListener("click", login);
document.getElementById("clearBtn").addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("postTrashBtn").addEventListener("click", postTrash);
document.getElementById("refreshTrashBtn").addEventListener("click", refreshData);

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
    setLoginStatus("Loading league hub…");
    await loadData();
    renderLoginManagers();

    if (state.manager && state.pin) {
      loginScreen.classList.add("auto-loading");
      setLoginStatus("Saved login found. Opening league hub…");
      await login(true);
      return;
    }

    setLoginStatus("v0.3.4 frontend UX polish");
  } catch (error) {
    setLoginStatus("Startup failed: " + error.message);
  }
}

async function login(isAutoLogin = false) {
  const manager = isAutoLogin ? state.manager : loginManagerSelect.value;
  const pin = isAutoLogin ? state.pin : loginPinInput.value.trim();

  if (!manager || !pin) {
    setLoginStatus("Select manager and enter PIN.");
    return;
  }

  setLoginStatus("Checking manager PIN...");

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
  setLoginStatus("Logged out. Select manager and enter PIN.");
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
  loginManagerSelect.innerHTML = `<option value="">Select manager</option>`;

  managers.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.manager;
    option.textContent = m.teamName ? `${m.teamName} — ${m.manager}` : m.manager;
    loginManagerSelect.appendChild(option);
  });

  if (state.manager) loginManagerSelect.value = state.manager;
}

function renderApp() {
  const data = state.appData || {};
  const settings = data.settings || {};

  document.getElementById("managerLine").textContent = state.teamName
    ? `${state.teamName} — ${state.manager}`
    : `Manager: ${state.manager}`;

  const verifiedManagerName = document.getElementById("verifiedManagerName");
  if (verifiedManagerName) {
    verifiedManagerName.textContent = state.teamName
      ? `${state.teamName} — ${state.manager}`
      : state.manager;
  }

  renderHome(settings);
  renderRules(data.rules || []);
  renderChampions(data.champions || []);
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
    <section class="card">
      <h3>Rules</h3>
      <p class="muted">Loaded from league backend. Rule wording cleanup comes next.</p>
    </section>
  `;

  if (!rules.length) {
    section.innerHTML += `<section class="card"><p class="muted">No rules loaded yet.</p></section>`;
    return;
  }

  rules.forEach((rule) => {
    const card = document.createElement("section");
    card.className = "card rule-card";
    card.innerHTML = `
      <h3>${escapeHtml(rule.title)}</h3>
      <p><b>Issue:</b> ${escapeHtml(rule.issue)}</p>
      <p><b>Solution:</b> ${escapeHtml(rule.solution)}</p>
      <span class="tag">${escapeHtml(rule.status)}</span>
    `;
    section.appendChild(card);
  });
}

function renderChampions(champions) {
  const section = document.getElementById("champs");
  section.innerHTML = `
    <section class="card">
      <h3>Champions Wall</h3>
      <p class="muted">Loaded from the Champions tab.</p>
    </section>
  `;

  if (!champions.length) {
    section.innerHTML += `<section class="card"><p class="muted">No champion rows loaded yet.</p></section>`;
    return;
  }

  champions.forEach((champ) => {
    const card = document.createElement("section");
    card.className = "card champ-card";
    card.innerHTML = `
      <span class="year">${escapeHtml(champ.year)}</span>
      <h3>${escapeHtml(champ.champion || "TBD")}</h3>
      <p>Runner-up: ${escapeHtml(champ.runnerUp || "TBD")}</p>
      <p class="muted">${escapeHtml(champ.notes || "")}</p>
    `;
    section.appendChild(card);
  });
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

    const card = document.createElement("div");
    card.className = "thread-card" + (isOpen ? " open" : "");

    const head = document.createElement("button");
    head.className = "thread-head";
    head.type = "button";
    head.innerHTML = `
      <span class="thread-title">${escapeHtml(thread.title)}</span>
      <span class="thread-meta">${thread.posts.length} post${thread.posts.length === 1 ? "" : "s"} · Started by ${escapeHtml(displayPoster(thread.root))}</span>
      <span class="thread-toggle">${isOpen ? "Hide posts" : "Show posts"}</span>
    `;
    head.addEventListener("click", () => toggleThread(thread.root.id));

    const body = document.createElement("div");
    body.className = "thread-body";

    thread.posts.forEach((post) => {
      const div = document.createElement("div");
      div.className = "thread-post";
      div.innerHTML = `
        <span class="post-meta">${escapeHtml(displayPoster(post))} · ${escapeHtml(post.timestamp || "")}</span>
        ${escapeHtml(post.message)}
      `;
      body.appendChild(div);
    });

    const replyButton = document.createElement("button");
    replyButton.className = "secondary-btn compact-btn thread-reply-btn";
    replyButton.type = "button";
    replyButton.textContent = "Reply";
    replyButton.addEventListener("click", () => setReplyThread(thread.root.id, thread.title));
    body.appendChild(replyButton);

    card.appendChild(head);
    card.appendChild(body);
    trashList.appendChild(card);
  });
}

function buildThreads(posts) {
  const byId = new Map();
  posts.forEach((post) => {
    if (post.id) byId.set(post.id, post);
  });

  const roots = [];
  const repliesByParent = new Map();

  posts.forEach((post) => {
    if (post.parentId && byId.has(post.parentId)) {
      if (!repliesByParent.has(post.parentId)) repliesByParent.set(post.parentId, []);
      repliesByParent.get(post.parentId).push(post);
    } else {
      roots.push(post);
    }
  });

  return roots.map((root) => {
    const replies = repliesByParent.get(root.id) || [];
    const title = root.threadTitle || root.message.slice(0, 60) || "Trash Thread";
    return {
      title,
      root,
      posts: [root, ...replies].reverse()
    };
  });
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

function setReplyThread(parentId, title) {
  state.replyingToId = parentId || "";
  state.replyingToTitle = title || "";

  const notice = document.getElementById("threadReplyNotice");
  const titleInput = document.getElementById("threadTitleInput");

  if (state.replyingToId) {
    state.expandedThreads.add(state.replyingToId);
    titleInput.value = state.replyingToTitle;
    notice.classList.remove("hidden");
    notice.innerHTML = `
      Replying to: <b>${escapeHtml(state.replyingToTitle)}</b><br>
      <button class="secondary-btn compact-btn" type="button" id="newThreadBtn">Start New Thread</button>
    `;
    document.getElementById("newThreadBtn").addEventListener("click", clearReplyThread);
    renderThreads(state.appData?.trash || []);
    document.querySelector(".add-trash-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("trashMessage").focus();
  }
}

function clearReplyThread() {
  state.replyingToId = "";
  state.replyingToTitle = "";
  document.getElementById("threadTitleInput").value = "";
  const notice = document.getElementById("threadReplyNotice");
  notice.classList.add("hidden");
  notice.innerHTML = "";
}

async function postTrash() {
  const titleInput = document.getElementById("threadTitleInput");
  const textarea = document.getElementById("trashMessage");
  const message = textarea.value.trim();
  const threadTitle = titleInput.value.trim();
  const status = document.getElementById("trashStatus");

  if (!message) {
    status.textContent = "Type a message first.";
    return;
  }

  status.textContent = "Adding trash...";

  try {
    await api("submitTrashTalk", {
      manager: state.manager,
      pin: state.pin,
      message,
      parentId: state.replyingToId,
      threadTitle
    });

    const postedParentId = state.replyingToId;
    textarea.value = "";
    if (!state.replyingToId) titleInput.value = "";
    clearReplyThread();
    if (postedParentId) state.expandedThreads.add(postedParentId);
    status.textContent = "Added. Refreshing...";
    await refreshData(true);
    status.textContent = "Added.";
    setTimeout(() => {
      if (status.textContent === "Added.") status.textContent = "";
    }, 1400);
  } catch (error) {
    status.textContent = "Post failed: " + error.message;
  }
}

function displayPoster(post) {
  if (post.teamName && post.manager) return `${post.teamName} — ${post.manager}`;
  return post.manager || "League";
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
