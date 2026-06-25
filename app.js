/*
  2B1C FFL
  v0.3.1 — GitHub frontend + Apps Script API bridge

  If your Apps Script web app URL changes, replace this value.
*/
const APPS_SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbx1r1DRzTOZj9wy1NRspGRc-Nq51oypZGl6upojMG4NUGmZMH7GMCPPWBClFRl08rAtaA/exec";

const AUTO_REFRESH_MS = 25000;

const state = {
  loggedIn: false,
  password: localStorage.getItem("leaguePassword") || "",
  verifiedManager: localStorage.getItem("verifiedManager") || "",
  verifiedPin: localStorage.getItem("verifiedPin") || "",
  currentTab: "home",
  appData: null,
  trashTimer: null
};

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginStatus = document.getElementById("loginStatus");
const passwordInput = document.getElementById("passwordInput");
const trashList = document.getElementById("trashList");

document.getElementById("enterBtn").addEventListener("click", login);
document.getElementById("clearBtn").addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);

document.getElementById("verifyManagerBtn").addEventListener("click", verifyManager);
document.getElementById("forgetManagerBtn").addEventListener("click", forgetManager);
document.getElementById("postTrashBtn").addEventListener("click", postTrash);
document.getElementById("refreshTrashBtn").addEventListener("click", refreshData);

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});

window.addEventListener("focus", () => {
  if (state.loggedIn && state.currentTab === "trash") refreshData(true);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.loggedIn && state.currentTab === "trash") refreshData(true);
});

init();

function init() {
  if (state.password) {
    passwordInput.value = state.password;
  }

  loginStatus.innerHTML = `v0.3.1 API bridge <span class="api-badge">GitHub + GAS</span>`;
}

async function login() {
  const password = passwordInput.value.trim();

  if (!password) {
    setLoginStatus("Enter the league password.");
    return;
  }

  setLoginStatus("Checking password...");

  try {
    const response = await api("checkPassword", { password });

    if (!response.valid) {
      setLoginStatus("Wrong password.");
      return;
    }

    state.password = password;
    state.loggedIn = true;
    localStorage.setItem("leaguePassword", password);

    setLoginStatus("Loading league data...");
    await loadData();

    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    startAutoRefresh();
  } catch (error) {
    setLoginStatus("Login failed: " + error.message);
  }
}

function clearSaved() {
  localStorage.removeItem("leaguePassword");
  state.password = "";
  passwordInput.value = "";
  setLoginStatus("Saved password cleared.");
}

function logout() {
  localStorage.removeItem("leaguePassword");
  state.password = "";
  state.loggedIn = false;
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

async function loadData() {
  const response = await api("getAppData", { password: state.password });
  state.appData = response.data;
  renderApp();
}

async function refreshData(silent = false) {
  if (!state.loggedIn || !state.password) return;

  const trashStatus = document.getElementById("trashStatus");
  if (!silent && trashStatus) trashStatus.textContent = "Refreshing...";

  try {
    await loadData();
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

function renderApp() {
  const data = state.appData || {};
  const settings = data.settings || {};

  document.getElementById("managerLine").textContent = state.verifiedManager
    ? `Posting as ${state.verifiedManager}`
    : "Connected to league data";

  renderManagers(data.managers || []);
  renderTrash(data.trash || []);
  renderVerifiedManager();
  renderHome(settings);
  renderRules(data.rules || []);
  renderChampions(data.champions || []);
}

function renderHome(settings) {
  const draftDate = settings.draftDate || "September 3, 2026";
  const buyIn = settings.buyIn || "$100";
  const payouts = settings.payouts || "1st $800 / 2nd $300 / 3rd $100";

  const statCards = document.querySelectorAll(".stat-card");
  if (statCards[0]) {
    statCards[0].querySelector("strong").textContent = draftDate.replace("September", "Sept.").replace(", 2026", "");
  }
  if (statCards[1]) {
    statCards[1].querySelector("strong").textContent = buyIn;
  }

  const paySection = document.getElementById("pay");
  if (paySection) {
    const paragraphs = paySection.querySelectorAll(".card p");
    if (paragraphs[0]) paragraphs[0].innerHTML = `<b>Amount:</b> ${escapeHtml(buyIn)}`;
    if (paragraphs[1]) paragraphs[1].innerHTML = `<b>Payouts:</b> ${escapeHtml(payouts)}`;
  }
}

function renderRules(rules) {
  const section = document.getElementById("rules");
  if (!section || !rules.length) return;

  section.innerHTML = `
    <section class="card">
      <h3>Rules</h3>
      <p class="muted">Loaded from Apps Script backend. Rule tabs can move to Sheet later.</p>
    </section>
  `;

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
  if (!section || !champions.length) return;

  section.innerHTML = `
    <section class="card">
      <h3>Champions Wall</h3>
      <p class="muted">Loaded from the Champions tab.</p>
    </section>
  `;

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

function renderManagers(managers) {
  const select = document.getElementById("managerSelect");
  select.innerHTML = `<option value="">Select manager</option>`;

  managers.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.manager;
    option.textContent = m.manager;
    select.appendChild(option);
  });

  if (state.verifiedManager) select.value = state.verifiedManager;
}

function renderVerifiedManager() {
  const verifiedBox = document.getElementById("verifiedBox");
  const verifyBox = document.getElementById("verifyBox");
  const name = document.getElementById("verifiedManagerName");

  if (state.verifiedManager && state.verifiedPin) {
    verifiedBox.classList.remove("hidden");
    verifyBox.classList.add("hidden");
    name.textContent = state.verifiedManager;
  } else {
    verifiedBox.classList.add("hidden");
    verifyBox.classList.remove("hidden");
    name.textContent = "";
  }
}

async function verifyManager() {
  const manager = document.getElementById("managerSelect").value;
  const pin = document.getElementById("pinInput").value.trim();
  const status = document.getElementById("verifyStatus");

  if (!manager || !pin) {
    status.textContent = "Select manager and enter PIN.";
    return;
  }

  status.textContent = "Checking PIN...";

  try {
    const response = await api("verifyManagerPin", {
      password: state.password,
      manager,
      pin
    });

    if (!response.data || !response.data.ok) {
      status.textContent = response.data?.message || "Invalid manager/PIN combo.";
      return;
    }

    state.verifiedManager = manager;
    state.verifiedPin = pin;
    localStorage.setItem("verifiedManager", manager);
    localStorage.setItem("verifiedPin", pin);
    document.getElementById("pinInput").value = "";
    status.textContent = "";
    renderVerifiedManager();
    renderApp();
  } catch (error) {
    status.textContent = "PIN check failed: " + error.message;
  }
}

function forgetManager() {
  localStorage.removeItem("verifiedManager");
  localStorage.removeItem("verifiedPin");
  state.verifiedManager = "";
  state.verifiedPin = "";
  renderVerifiedManager();
  renderApp();
}

async function postTrash() {
  const textarea = document.getElementById("trashMessage");
  const message = textarea.value.trim();
  const status = document.getElementById("trashStatus");

  if (!state.verifiedManager || !state.verifiedPin) {
    status.textContent = "Verify manager/PIN first.";
    return;
  }

  if (!message) {
    status.textContent = "Type a message first.";
    return;
  }

  status.textContent = "Posting...";

  try {
    await api("submitTrashTalk", {
      password: state.password,
      manager: state.verifiedManager,
      pin: state.verifiedPin,
      message
    });

    textarea.value = "";
    status.textContent = "Posted. Refreshing...";
    await refreshData(true);
    status.textContent = "Posted.";
    setTimeout(() => {
      if (status.textContent === "Posted.") status.textContent = "";
    }, 1400);
  } catch (error) {
    status.textContent = "Post failed: " + error.message;
  }
}

function renderTrash(posts) {
  trashList.innerHTML = "";

  if (!posts.length) {
    trashList.innerHTML = `<p class="muted">No trash talk yet.</p>`;
    return;
  }

  posts.forEach((post) => {
    const div = document.createElement("div");
    div.className = "trash-post";
    div.innerHTML = `
      <b>${escapeHtml(post.manager)}</b>
      <span class="muted">${escapeHtml(post.timestamp || "")}</span><br>
      ${escapeHtml(post.message)}
    `;
    trashList.appendChild(div);
  });
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
 * This avoids browser CORS issues between GitHub Pages and Apps Script.
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
