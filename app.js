const MOCK_PASSWORD = "2B1C2026";

const state = {
  loggedIn: localStorage.getItem("mockLoggedIn") === "true",
  manager: localStorage.getItem("mockManager") || "Will Sorensen",
  posts: [
    { manager: "Will Sorensen", message: "GitHub shell prototype is live." },
    { manager: "League Bot", message: "Backend/API wiring comes next." }
  ]
};

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginStatus = document.getElementById("loginStatus");
const passwordInput = document.getElementById("passwordInput");
const trashList = document.getElementById("trashList");

document.getElementById("enterBtn").addEventListener("click", login);
document.getElementById("clearBtn").addEventListener("click", clearSaved);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("mockPostBtn").addEventListener("click", postMockTrash);

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});

function login() {
  const password = passwordInput.value.trim();

  if (!password) {
    loginStatus.textContent = "Enter the league password.";
    return;
  }

  if (password !== MOCK_PASSWORD) {
    loginStatus.textContent = "Prototype password is 2B1C2026.";
    return;
  }

  localStorage.setItem("mockLoggedIn", "true");
  state.loggedIn = true;
  render();
}

function clearSaved() {
  localStorage.removeItem("mockLoggedIn");
  passwordInput.value = "";
  loginStatus.textContent = "Saved prototype login cleared.";
}

function logout() {
  localStorage.removeItem("mockLoggedIn");
  state.loggedIn = false;
  render();
}

function showTab(id) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === id);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function postMockTrash() {
  const textarea = document.getElementById("trashMessage");
  const message = textarea.value.trim();

  if (!message) return;

  state.posts.unshift({ manager: state.manager, message });
  textarea.value = "";
  renderTrash();
}

function renderTrash() {
  trashList.innerHTML = "";

  state.posts.forEach((post) => {
    const div = document.createElement("div");
    div.className = "trash-post";
    div.innerHTML = `<b>${escapeHtml(post.manager)}</b><br>${escapeHtml(post.message)}`;
    trashList.appendChild(div);
  });
}

function render() {
  loginScreen.classList.toggle("hidden", state.loggedIn);
  appScreen.classList.toggle("hidden", !state.loggedIn);
  document.getElementById("managerLine").textContent = `Prototype as ${state.manager}`;
  renderTrash();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
