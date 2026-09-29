import { AuthRequiredError, getAccessToken, getSession, handleRedirect, isConfigured, renewSilently, signIn, signOut } from "./auth.js";
import { monthOf, monthSummary } from "./balance.js";
import { LANGS, countLabel, lang, setLang, t } from "./i18n.js";
import { googleLogo, icon, logo, microsoftLogo } from "./icons.js";
import { canOfferInstall, isIos, promptInstall } from "./install.js";
import { THEMES, applyTheme, setTheme, theme } from "./theme.js";
import {
  avatar,
  centsToInput,
  currentMonth,
  dateLabel,
  dayLabel,
  esc,
  firstName,
  formatMoney,
  monthLabel,
  monthName,
  monthYearText,
  parseMoney,
  shiftMonth,
  todayIso,
} from "./util.js";
import {
  MIN_PASSWORD,
  NotMemberError,
  createWallet,
  driverFor,
  driverForProvider,
  joinWithCode,
  loadWallet,
  mutateWallet,
  openWallet,
  providerOf,
  providerOfCode,
  rules,
} from "./wallet.js";

const app = document.getElementById("app");
const PROVIDER_NAME = { google: "Google", microsoft: "Microsoft", demo: "Demo" };
const storageName = (provider) =>
  t({ google: "storageGoogle", microsoft: "storageMicrosoft", demo: "storageDemo" }[provider] ?? "storageGoogle");

let session = getSession();
let renderSeq = 0;

// ---------- infrastruttura ----------

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = hash.split("?");
  return { seg: path.split("/").filter(Boolean), q: new URLSearchParams(qs) };
}

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

const walletHref = (key, tab = "", month) =>
  `#/w/${encodeURIComponent(key)}${tab ? `/${tab}` : ""}${month ? `?m=${month}` : ""}`;

function render(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

export function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function confirmDialog({ title, text, ok = t("confirm"), danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="sheet-grip"></div>
        <h3 id="dlg-title">${esc(title)}</h3>
        <p class="muted">${esc(text)}</p>
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-v="0">${esc(t("cancel"))}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-v="1">${esc(ok)}</button>
        </div>
      </div>`;
    const close = (v) => {
      wrap.classList.remove("show");
      setTimeout(() => wrap.remove(), 250);
      resolve(v);
    };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close(false);
      const b = e.target.closest("[data-v]");
      if (b) close(b.dataset.v === "1");
    });
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("show"));
  });
}

/** Pannello dal basso generico. Si chiude toccando fuori, con Esc o con [data-action=close]. */
function openSheet(inner, className = "") {
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet ${className}" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${inner}</div>`;
  const onKey = (e) => e.key === "Escape" && close();
  const close = ({ instant = false } = {}) => {
    document.removeEventListener("keydown", onKey);
    if (instant) return wrap.remove();
    wrap.classList.remove("show");
    setTimeout(() => wrap.remove(), 250);
  };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-action=close]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  return { el: wrap.querySelector(".sheet"), close };
}

/** Selettore della lingua (menu utente e pagina di login). */
const langSelect = (className = "") => `
  <select class="lang-select ${className}" data-lang-select aria-label="${esc(t("language"))}">
    ${Object.entries(LANGS)
      .map(([code, label]) => `<option value="${code}" ${code === lang ? "selected" : ""}>${label}</option>`)
      .join("")}
  </select>`;

// ---------- menu utente (come le impostazioni di Spendly) ----------

const THEME_OPTIONS = { system: ["themeSystem", "monitor"], light: ["themeLight", "sun"], dark: ["themeDark", "moon"] };

const userButton = () =>
  `<button class="user-btn" data-user-menu aria-label="${esc(t("userMenu"))}" aria-haspopup="dialog">${avatar(session.user, 40)}</button>`;

function openUserMenu({ instant = false } = {}) {
  if (!session) return;
  const user = session.user;
  const inHome = parseHash().seg.length === 0;
  const { el, close } = openSheet(
    `
    <div class="sheet-head">
      <h3>${esc(t("settings"))}</h3>
      <button class="icon-btn small" data-action="close" aria-label="${esc(t("close"))}">${icon("close", 18)}</button>
    </div>
    <div class="account-card">
      ${avatar(user, 52)}
      <div>
        <strong>${esc(user.name)}</strong>
        <span class="muted">${esc(user.email)}</span>
        <small class="muted">${esc(session.provider === "demo" ? t("demoMode") : t("signedInWith", { provider: PROVIDER_NAME[session.provider] }))}</small>
      </div>
    </div>

    <div class="menu-label">${esc(t("language"))}</div>
    ${langSelect("block")}

    <div class="menu-label">${esc(t("theme"))}</div>
    <div class="segmented" role="radiogroup" aria-label="${esc(t("theme"))}">
      ${THEMES.map(
        (th) =>
          `<button role="radio" aria-checked="${th === theme}" data-theme-choice="${th}">${icon(THEME_OPTIONS[th][1], 18)}<span>${esc(t(THEME_OPTIONS[th][0]))}</span></button>`,
      ).join("")}
    </div>

    <div class="menu-list">
      ${
        canOfferInstall()
          ? `<button class="menu-item" data-action="install">${icon("download", 20)}<span>${esc(t("installApp"))}</span>${icon("next", 18)}</button>`
          : ""
      }
      ${inHome ? "" : `<a class="menu-item" href="#/">${icon("wallet", 20)}<span>${esc(t("allWallets"))}</span>${icon("next", 18)}</a>`}
      <button class="menu-item danger" data-action="logout">${icon("logout", 20)}<span>${esc(t("logout"))}</span></button>
    </div>`,
    "menu-sheet",
  );
  if (instant) el.closest(".sheet-backdrop").classList.add("show", "no-anim");

  el.querySelector("[data-lang-select]").addEventListener("change", (e) => {
    // ridisegna la pagina nella nuova lingua e riapre il menu, già tradotto
    changeLanguage(e.target.value);
    close({ instant: true });
    openUserMenu({ instant: true });
  });
  el.querySelectorAll("[data-theme-choice]").forEach((b) =>
    b.addEventListener("click", () => {
      setTheme(b.dataset.themeChoice);
      el.querySelectorAll("[data-theme-choice]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }),
  );
  el.querySelector("[data-action=install]")?.addEventListener("click", async () => {
    close();
    if (!(await promptInstall())) openInstallHelp();
  });
  el.querySelector("[data-action=logout]").addEventListener("click", async () => {
    close();
    const ok = await confirmDialog({ title: t("logoutTitle"), text: t("logoutText"), ok: t("logout"), danger: true });
    if (ok) logout();
  });
}

function changeLanguage(next) {
  setLang(next);
  route({ keepSheets: true });
}

/** Nessun prompt del browser (sempre così su iPhone): si spiegano i passaggi a mano. */
function openInstallHelp() {
  openSheet(`
    <div class="sheet-head">
      <h3>${esc(t("installApp"))}</h3>
      <button class="icon-btn small" data-action="close" aria-label="${esc(t("close"))}">${icon("close", 18)}</button>
    </div>
    <div class="install-help">
      ${logo(56)}
      <p>${isIos ? t("installIos", { icon: icon("share", 16) }) : t("installManual")}</p>
      <p class="muted small">${esc(t("installNote"))}</p>
    </div>
    <button class="btn btn-primary btn-block" data-action="close">${esc(t("gotIt"))}</button>`);
}

async function busy(button, label, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  try {
    return await fn();
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function loadingScreen(title = "") {
  render(`
    ${title ? `<header class="topbar"><a class="icon-btn" href="#/" aria-label="${esc(t("back"))}">${icon("back")}</a><div class="topbar-title"><h1>${esc(title)}</h1></div></header>` : ""}
    <div class="page">
      <div class="skeleton skeleton-hero"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
    </div>`);
}

function errorScreen(err) {
  if (err instanceof AuthRequiredError) {
    // Google: il token dura un'ora, si rinnova da solo con un redirect silenzioso
    if (renewSilently()) {
      render(`<div class="page center-page"><span class="spinner big"></span><p class="muted">${esc(t("reconnecting"))}</p></div>`);
      return;
    }
    render(`
      <div class="page center-page">
        <div class="empty-icon">${icon("lock", 32)}</div>
        <h2>${esc(t("sessionExpired"))}</h2>
        <p class="muted">${esc(t("sessionExpiredText", { storage: session ? storageName(session.provider) : "cloud" }))}</p>
        <button class="btn btn-primary btn-block" id="reconnect">${icon("refresh", 20)} ${esc(t("reconnect"))}</button>
        <button class="btn btn-ghost btn-block" id="logout">${esc(t("logout"))}</button>
      </div>`);
    app.querySelector("#reconnect").addEventListener("click", async (e) => {
      try {
        await busy(e.target.closest("button"), t("connecting"), () => getAccessToken({ interactive: true }));
        route();
      } catch (error) {
        toast(error.message, "error");
      }
    });
    app.querySelector("#logout").addEventListener("click", logout);
    return;
  }
  console.error(err);
  render(`
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="${esc(t("back"))}">${icon("back")}</a></header>
    <div class="page center-page">
      <div class="empty-icon danger">${icon("sparkle", 32)}</div>
      <h2>${esc(t("somethingWrong"))}</h2>
      <p class="muted">${esc(err?.message || err)}</p>
      <button class="btn btn-primary btn-block" id="retry">${icon("refresh", 20)} ${esc(t("retry"))}</button>
    </div>`);
  app.querySelector("#retry").addEventListener("click", () => route());
}

function logout() {
  signOut();
  session = null;
  go("#/login");
}

// ---------- wallet predefinito (salvato nel browser, per utente) ----------

const defaultStorageKey = () => `fw.default.${session.provider}.${session.user.id}`;

function getDefaultWallet() {
  try {
    return session ? localStorage.getItem(defaultStorageKey()) : null;
  } catch {
    return null;
  }
}

function setDefaultWallet(key) {
  try {
    if (key) localStorage.setItem(defaultStorageKey(), key);
    else localStorage.removeItem(defaultStorageKey());
  } catch {
    // storage non disponibile (es. navigazione privata): la preferenza non viene ricordata
  }
}

/** All'avvio (o subito dopo il login) apre il wallet predefinito al posto della home. */
function startHash(hash) {
  const key = getDefaultWallet();
  return key && ["", "#", "#/"].includes(hash) ? walletHref(key) : hash;
}

function bottomNav(key, active, month) {
  const item = (tab, label, ic) =>
    `<a class="nav-item ${active === tab ? "active" : ""}" href="${walletHref(key, tab === "mese" ? "" : tab, month)}">${icon(ic)}<span>${esc(label)}</span></a>`;
  return `
    <nav class="bottom-nav">
      <a class="nav-item" href="#/">${icon("home")}<span>${esc(t("navWallets"))}</span></a>
      ${item("mese", t("navMonth"), "chart")}
      <a class="fab" href="${walletHref(key, "nuova", month)}" aria-label="${esc(t("newExpense"))}">${icon("plus", 28)}</a>
      ${item("spese", t("navExpenses"), "list")}
      ${item("membri", t("navMembers"), "users")}
    </nav>`;
}

// ---------- router ----------

async function route({ keepSheets = false } = {}) {
  const seq = ++renderSeq;
  if (!keepSheets) document.querySelectorAll(".sheet-backdrop").forEach((el) => el.remove()); // chiude eventuali pannelli aperti
  session = getSession();
  const { seg, q } = parseHash();
  const stale = () => seq !== renderSeq;
  try {
    if (seg[0] === "accedi") return viewAccess(q);
    if (!session) {
      if (seg[0] !== "login") sessionStorage.setItem("fw.return", location.hash || "#/");
      return viewLogin();
    }
    if (seg.length === 0 || seg[0] === "login") return await viewHome(stale);
    if (seg[0] === "new") return viewNew();
    if (seg[0] === "w" && seg[1]) {
      const key = decodeURIComponent(seg[1]);
      if (providerOf(key) !== session.provider) {
        throw new Error(t("walletOnOtherProvider", { storage: storageName(providerOf(key)), provider: PROVIDER_NAME[providerOf(key)] }));
      }
      const tab = seg[2] || "mese";
      if (tab === "nuova") return await viewExpenseForm(key, null, q, stale);
      if (tab === "modifica") return await viewExpenseForm(key, seg[3], q, stale);
      return await viewWallet(key, tab, q, stale);
    }
    go("#/");
  } catch (err) {
    if (stale()) return;
    if (err instanceof NotMemberError) {
      const q = new URLSearchParams({ c: err.doc.code ?? "", n: err.doc.name });
      return viewAccess(q, err.message);
    }
    errorScreen(err);
  }
}

// ---------- login ----------

function viewLogin() {
  const btn = (provider, providerLogo) => `
    <button class="btn btn-social" data-provider="${provider}" ${isConfigured(provider) ? "" : "disabled"}>
      ${providerLogo}<span>${esc(t("continueWith", { provider: PROVIDER_NAME[provider] }))}</span>
    </button>`;
  render(`
    <div class="login">
      <div class="login-art" aria-hidden="true">
        <div class="art-card art-card-back"></div>
        <div class="art-card">
          <div class="art-chip"></div>
          <div class="art-label">${esc(t("artLabel"))}</div>
          <div class="art-amount">${formatMoney(128450)}</div>
          <div class="art-row"><span></span><span></span><span></span></div>
        </div>
        <div class="art-bubble art-bubble-1">${icon("check", 18)} ${esc(t("artSettled"))}</div>
        <div class="art-bubble art-bubble-2">Selene → Fabiano · ${formatMoney(10000)}</div>
      </div>
      <div class="login-body">
        <div class="login-top">
          <div class="brand">${logo(32)}<span>Family Wallet</span></div>
          ${langSelect()}
        </div>
        <h1>${esc(t("headline1"))}<br><span class="accent">${esc(t("headline2"))}</span></h1>
        <p class="muted">${esc(t("tagline"))}</p>
        <div class="login-buttons">
          ${btn("google", googleLogo)}
          ${btn("microsoft", microsoftLogo)}
          <button class="btn btn-link" data-provider="demo">${esc(t("tryDemo"))}</button>
        </div>
        ${!isConfigured("google") && !isConfigured("microsoft") ? `<p class="hint">${t("notConfigured")}</p>` : ""}
      </div>
    </div>`);
  app.querySelector("[data-lang-select]").addEventListener("change", (e) => changeLanguage(e.target.value));
  app.querySelectorAll("[data-provider]").forEach((b) =>
    b.addEventListener("click", async () => {
      const returnHash = sessionStorage.getItem("fw.return") || "#/";
      try {
        await signIn(b.dataset.provider, returnHash);
        session = getSession();
        sessionStorage.removeItem("fw.return");
        go(startHash(returnHash === "#/login" ? "#/" : returnHash));
      } catch (err) {
        toast(err.message, "error");
      }
    }),
  );
}

// ---------- home: elenco wallet ----------

async function viewHome(stale) {
  const user = session.user;
  const header = `
    <header class="home-header">
      <div class="hello">
        ${logo(44)}
        <div><small class="muted">${esc(t("hello"))}</small><h1>${esc(firstName(user.name))}</h1></div>
      </div>
      ${userButton()}
    </header>`;
  const actions = `
    <div class="home-actions">
      <a class="action-tile action-primary" href="#/new">
        <span class="action-icon">${icon("plus", 24)}</span>
        <strong>${esc(t("createWallet"))}</strong>
        <small>${esc(t("createWalletSub"))}</small>
      </a>
      <a class="action-tile" href="#/accedi">
        <span class="action-icon">${icon("key", 24)}</span>
        <strong>${esc(t("accessWallet"))}</strong>
        <small>${esc(t("accessWalletSub"))}</small>
      </a>
    </div>`;
  render(`${header}<div class="page">${actions}<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>`);

  const wallets = (await driverForProvider(session.provider).list()).sort((a, b) => a.name.localeCompare(b.name));
  if (stale()) return;

  let defaultKey = getDefaultWallet();
  if (defaultKey && !wallets.some((w) => w.key === defaultKey)) {
    // il wallet predefinito non è più accessibile
    setDefaultWallet(null);
    defaultKey = null;
  }

  const cards = wallets
    .map(
      (w, i) => `
      <div class="wallet-item">
        <a class="wallet-link" href="${walletHref(w.key)}">
          <span class="wallet-tile tile-${i % 4}">${esc(w.name.charAt(0).toUpperCase())}</span>
          <span class="wallet-info">
            <strong>${esc(w.name)}</strong>
            <small class="muted">${esc(w.owned ? t("createdByYou") : w.ownerName ? t("sharedBy", { name: w.ownerName }) : t("shared"))}</small>
            <small class="default-label">${icon("star", 12)} ${esc(t("opensAtStart"))}</small>
          </span>
        </a>
        <button class="star-btn" data-key="${esc(w.key)}" data-name="${esc(w.name)}"></button>
      </div>`,
    )
    .join("");

  render(`
    ${header}
    <div class="page">
      ${actions}
      <div class="section-head"><h2>${esc(t("yourWallets"))}</h2><span class="muted">${wallets.length}</span></div>
      ${
        wallets.length
          ? `<div class="stack">${cards}</div>`
          : `<div class="empty"><div class="empty-icon">${icon("wallet", 32)}</div><p class="muted">${esc(t("noWallets"))}</p></div>`
      }
      ${wallets.length ? `<p class="hint center">${esc(t("starHint"))}</p>` : ""}
      <p class="hint center">${icon("sheet", 14)} ${esc(t("walletsAreSheets", { storage: storageName(session.provider) }))}</p>
    </div>`);

  const paintStars = () => {
    app.querySelectorAll(".star-btn").forEach((b) => {
      const active = b.dataset.key === defaultKey;
      b.closest(".wallet-item").classList.toggle("is-default", active);
      b.setAttribute("aria-pressed", String(active));
      b.setAttribute("aria-label", t(active ? "starOff" : "starOn", { name: b.dataset.name }));
      b.innerHTML = icon("star", 22);
    });
  };
  paintStars();
  app.querySelectorAll(".star-btn").forEach((b) =>
    b.addEventListener("click", () => {
      defaultKey = defaultKey === b.dataset.key ? null : b.dataset.key;
      setDefaultWallet(defaultKey);
      paintStars();
      toast(defaultKey ? t("willOpenAtStart", { name: b.dataset.name }) : t("listAtStart"), "success");
    }),
  );
}

// ---------- nuovo wallet ----------

function viewNew() {
  const place = t({ google: "placeGoogle", microsoft: "placeMicrosoft", demo: "placeDemo" }[session.provider]);
  render(`
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="${esc(t("back"))}">${icon("back")}</a><div class="topbar-title"><h1>${esc(t("newWallet"))}</h1></div></header>
    <form class="page" id="form" novalidate>
      <label class="field">
        <span>${esc(t("walletName"))}</span>
        <input name="name" required maxlength="50" placeholder="${esc(t("walletNamePlaceholder"))}" autocomplete="off">
      </label>
      <label class="field">
        <span>${esc(t("password"))}</span>
        <input name="password" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password" placeholder="${esc(t("passwordMin", { n: MIN_PASSWORD }))}">
      </label>
      <label class="field">
        <span>${esc(t("repeatPassword"))}</span>
        <input name="password2" type="password" required autocomplete="new-password">
      </label>
      <div class="info-card">
        ${icon("sheet", 20)}
        <p>${t("newWalletInfo", { storage: esc(storageName(session.provider)), place: esc(place) })}</p>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${icon("check", 20)} ${esc(t("createWallet"))}</button>
    </form>`);
  const form = app.querySelector("#form");
  form.name.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const password = form.password.value;
    if (!name) return toast(t("nameRequired"), "error");
    if (password.length < MIN_PASSWORD) return toast(t("passwordTooShort", { n: MIN_PASSWORD }), "error");
    if (password !== form.password2.value) return toast(t("passwordMismatch"), "error");
    try {
      const key = await busy(form.querySelector("[type=submit]"), t("creatingSheet"), () =>
        createWallet(session.provider, name, password, session.user),
      );
      toast(t("walletCreated"), "success");
      go(walletHref(key, "membri"));
    } catch (err) {
      if (err instanceof AuthRequiredError) return errorScreen(err);
      toast(err.message, "error");
    }
  });
}

// ---------- accedi a un wallet (codice + password) ----------

function viewAccess(q, message) {
  const code = q.get("c") || "";
  const walletName = q.get("n");
  const owner = q.get("o");
  const codeProvider = code ? providerOfCode(code) : null;

  const inviteHero = walletName
    ? `<div class="hero-card invite-card">
         <div class="hero-deco"></div>
         <div class="hero-label">${esc(message ? t("wallet") : t("invitedTo"))}</div>
         <div class="hero-amount">${esc(walletName)}</div>
         ${owner ? `<div class="hero-meta">${esc(t("byOwner", { name: owner }))}</div>` : ""}
       </div>`
    : "";

  if (!session) {
    sessionStorage.setItem("fw.return", location.hash);
    const providers = codeProvider ? [codeProvider] : ["google", "microsoft"];
    render(`
      <div class="page center-page join">
        <div class="brand center-brand">${logo(56)}<span>Family Wallet</span></div>
        ${inviteHero}
        <p class="muted center">${esc(t("loginToAccess"))}</p>
        ${providers
          .map(
            (p) =>
              `<button class="btn btn-social" data-provider="${p}" ${isConfigured(p) ? "" : "disabled"}>${p === "google" ? googleLogo : microsoftLogo}<span>${esc(t("signInWith", { provider: PROVIDER_NAME[p] }))}</span></button>`,
          )
          .join("")}
        ${codeProvider ? `<p class="hint center">${esc(t("needsAccount", { storage: storageName(codeProvider), provider: PROVIDER_NAME[codeProvider] }))}</p>` : ""}
        <div class="center">${langSelect()}</div>
      </div>`);
    app.querySelector("[data-lang-select]").addEventListener("change", (e) => changeLanguage(e.target.value));
    app.querySelectorAll("[data-provider]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await signIn(b.dataset.provider, location.hash);
          route();
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
    return;
  }

  const wrongProvider = codeProvider && codeProvider !== session.provider;
  render(`
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="${esc(t("back"))}">${icon("back")}</a><div class="topbar-title"><h1>${esc(t("accessTitle"))}</h1></div></header>
    <form class="page" id="form" novalidate>
      ${inviteHero}
      ${message ? `<div class="info-card">${icon("lock", 20)}<p>${esc(message)}</p></div>` : ""}
      ${
        wrongProvider
          ? `<div class="info-card warn">${icon("lock", 20)}<p>${esc(t("wrongProviderText", { storage: storageName(codeProvider), provider: PROVIDER_NAME[session.provider] }))}</p></div>
             <button class="btn btn-primary btn-block" type="button" id="switch">${esc(t("switchProvider", { provider: PROVIDER_NAME[codeProvider] }))}</button>`
          : ""
      }
      <label class="field">
        <span>${esc(t("walletCode"))}</span>
        <textarea name="code" rows="2" required spellcheck="false" autocomplete="off" placeholder="${esc(t("codePlaceholder"))}">${esc(code)}</textarea>
      </label>
      <label class="field">
        <span>${esc(t("password"))}</span>
        <input name="password" type="password" required autocomplete="current-password">
      </label>
      <button class="btn btn-primary btn-block" type="submit" ${wrongProvider ? "disabled" : ""}>${icon("key", 20)} ${esc(t("enterWallet"))}</button>
      <p class="hint center">${esc(t("accessHint"))}</p>
    </form>`);

  const form = app.querySelector("#form");
  (code ? form.password : form.code).focus();
  app.querySelector("#switch")?.addEventListener("click", () => {
    signOut();
    route();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.code.value.trim()) return toast(t("codeRequired"), "error");
    try {
      const key = await busy(form.querySelector("[type=submit]"), t("entering"), () =>
        joinWithCode(form.code.value, form.password.value, session.user, session.provider),
      );
      toast(t("welcomeIn"), "success");
      go(walletHref(key));
    } catch (err) {
      if (err instanceof AuthRequiredError) return errorScreen(err);
      toast(err.message, "error");
    }
  });
}

// ---------- wallet ----------

function memberLookup(doc) {
  const map = new Map(doc.members.map((m) => [m.id, m]));
  return (id) => map.get(id) ?? { id, name: id.split("@")[0] };
}

async function viewWallet(key, tab, q, stale) {
  loadingScreen();
  const doc = await openWallet(key, session.user);
  if (!doc || stale()) return;
  const month = /^\d{4}-\d{2}$/.test(q.get("m") ?? "") ? q.get("m") : currentMonth();
  const summary = monthSummary(doc, month);
  const member = memberLookup(doc);

  const monthSwitch = `
    <div class="month-switch">
      <a class="icon-btn small" href="${walletHref(key, tab === "mese" ? "" : tab, shiftMonth(month, -1))}" aria-label="${esc(t("prevMonth"))}">${icon("prev", 20)}</a>
      <span>${esc(monthLabel(month))}${summary.settlement ? ` <span class="badge badge-ok">${icon("check", 12)} ${esc(t("paid"))}</span>` : ""}</span>
      <a class="icon-btn small" href="${walletHref(key, tab === "mese" ? "" : tab, shiftMonth(month, 1))}" aria-label="${esc(t("nextMonth"))}">${icon("next", 20)}</a>
    </div>`;

  const header = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="${esc(t("allWallets"))}">${icon("back")}</a>
      <div class="topbar-title"><small class="muted">${esc(t("wallet"))}</small><h1>${esc(doc.name)}</h1></div>
      <button class="icon-btn" id="refresh" aria-label="${esc(t("refresh"))}">${icon("refresh", 20)}</button>
      ${userButton()}
    </header>`;

  let body;
  if (tab === "spese") body = expensesTab(key, doc, summary, member, q);
  else if (tab === "membri") body = membersTab(key, doc);
  else body = monthTab(key, doc, summary, member);

  render(`${header}<div class="page with-nav">${tab === "membri" ? "" : monthSwitch}${body}</div>${bottomNav(key, tab, month)}`);

  app.querySelector("#refresh").addEventListener("click", async (e) => {
    await busy(e.target.closest("button"), "", () => loadWallet(key, { fresh: true })).catch((err) => toast(err.message, "error"));
    route();
  });
  bindWalletActions(key, doc, month);
}

function expenseRow(key, e, member, month, locked) {
  const who = member(e.createdBy);
  const mine = e.createdBy === session.user.id;
  const splitText =
    e.splitAmong.length === 1
      ? t("onlyName", { name: firstName(member(e.splitAmong[0]).name) })
      : t("splitBetween", { n: e.splitAmong.length });
  const inner = `
    ${avatar(who, 42)}
    <span class="tx-info">
      <strong>${esc(e.note || t("expense"))}</strong>
      <small class="muted">${esc(mine ? t("you") : firstName(who.name))} · ${esc(splitText)}</small>
    </span>
    <span class="tx-amount">${formatMoney(e.amountCents)}${mine && locked ? `<small>${icon("lock", 12)}</small>` : ""}</span>`;
  return mine && !locked
    ? `<a class="tx" href="${walletHref(key, `modifica/${e.id}`, month)}">${inner}</a>`
    : `<div class="tx">${inner}</div>`;
}

function monthTab(key, doc, s, member) {
  const me = s.balances.find((b) => b.memberId === session.user.id) ?? { paidCents: 0, shareCents: 0, balanceCents: 0 };
  const thisMonth = monthName(s.month);

  const transfers = s.transfers.length
    ? s.transfers
        .map((tr) => {
          const from = member(tr.from);
          const to = member(tr.to);
          const involved = tr.from === session.user.id || tr.to === session.user.id;
          const line = t("transferLine", {
            from: `<strong>${esc(firstName(from.name))}</strong>`,
            amount: `<strong class="amount">${formatMoney(tr.amountCents)}</strong>`,
            to: `<strong>${esc(firstName(to.name))}</strong>`,
          });
          return `
          <div class="transfer ${involved ? "me" : ""}">
            <div class="transfer-people">${avatar(from, 36)}<span class="transfer-arrow">${icon("arrow", 16)}</span>${avatar(to, 36)}</div>
            <p>${line}</p>
          </div>`;
        })
        .join("")
    : `<p class="muted center pad">${esc(s.expenses.length ? t("allEven") : t("noExpensesMonth"))}</p>`;

  const settleBlock = s.settlement
    ? `<div class="settled">
         ${icon("check", 20)}
         <div><strong>${esc(t("monthSettled"))}</strong><small class="muted">${esc(t("settledBy", { name: firstName(member(s.settlement.settledBy).name), date: dateLabel(s.settlement.settledAt) }))}</small></div>
         <button class="btn btn-ghost btn-small" id="reopen">${icon("unlock", 16)} ${esc(t("reopen"))}</button>
       </div>`
    : s.expenses.length
      ? `<button class="btn btn-primary btn-block" id="settle">${icon("check", 20)} ${esc(t("settleMonthBtn", { month: thisMonth }))}</button>`
      : "";

  const maxPaid = Math.max(1, ...s.balances.map((b) => b.paidCents));
  const people = [...s.balances]
    .sort((a, b) => b.paidCents - a.paidCents)
    .map((b) => {
      const m = member(b.memberId);
      const chip =
        b.balanceCents > 0
          ? `<span class="chip chip-in">+${formatMoney(b.balanceCents)}</span>`
          : b.balanceCents < 0
            ? `<span class="chip chip-out">−${formatMoney(-b.balanceCents)}</span>`
            : `<span class="chip">${esc(t("even"))}</span>`;
      return `
        <div class="person">
          ${avatar(m, 40)}
          <div class="person-info">
            <div class="person-top"><strong>${esc(b.memberId === session.user.id ? t("you") : m.name)}</strong>${chip}</div>
            <div class="bar"><span style="width:${Math.round((b.paidCents / maxPaid) * 100)}%"></span></div>
            <small class="muted">${esc(t("paidShare", { paid: formatMoney(b.paidCents), share: formatMoney(b.shareCents) }))}</small>
          </div>
        </div>`;
    })
    .join("");

  const recent = [...s.expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4)
    .map((e) => expenseRow(key, e, member, s.month, Boolean(s.settlement)))
    .join("");

  return `
    <section class="hero-card">
      <div class="hero-deco"></div>
      <div class="hero-label">${esc(t("monthExpenses", { month: thisMonth }))}</div>
      <div class="hero-amount">${formatMoney(s.totalCents)}</div>
      <div class="hero-stats">
        <div><small>${esc(t("youPaid"))}</small><strong>${formatMoney(me.paidCents)}</strong></div>
        <div><small>${esc(t("yourShare"))}</small><strong>${formatMoney(me.shareCents)}</strong></div>
        <div><small>${esc(me.balanceCents >= 0 ? t("toReceive") : t("toGive"))}</small><strong>${formatMoney(Math.abs(me.balanceCents))}</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${esc(t("whoOwesWhom"))}</h2></div>
      ${transfers}
      ${settleBlock}
    </section>

    ${
      s.balances.length
        ? `<section class="card"><div class="card-head"><h2>${esc(t("whoSpent"))}</h2></div>${people}</section>`
        : ""
    }

    ${
      recent
        ? `<div class="section-head"><h2>${esc(t("latestExpenses"))}</h2><a href="${walletHref(key, "spese", s.month)}">${esc(t("seeAll"))}</a></div><div class="card list-card">${recent}</div>`
        : ""
    }`;
}

function expensesTab(key, doc, s, member, q) {
  const filter = q.get("chi");
  const expenses = s.expenses
    .filter((e) => !filter || e.createdBy === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const chips = [
    `<a class="filter ${!filter ? "active" : ""}" href="${walletHref(key, "spese", s.month)}">${esc(t("all"))}</a>`,
    ...doc.members.map(
      (m) =>
        `<a class="filter ${filter === m.id ? "active" : ""}" href="${walletHref(key, "spese", s.month)}&chi=${encodeURIComponent(m.id)}">${esc(m.id === session.user.id ? t("me") : firstName(m.name))}</a>`,
    ),
  ].join("");

  const groups = new Map();
  for (const e of expenses) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  const list = [...groups.entries()]
    .map(
      ([date, items]) => `
      <div class="day-head"><span>${esc(dayLabel(date))}</span><span>${formatMoney(items.reduce((sum, e) => sum + e.amountCents, 0))}</span></div>
      <div class="card list-card">${items.map((e) => expenseRow(key, e, member, s.month, Boolean(s.settlement))).join("")}</div>`,
    )
    .join("");

  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const emptyText = t(filter ? "noExpensesPersonIn" : "noExpensesIn", { month: monthYearText(s.month) });
  return `
    <div class="filters">${chips}</div>
    <div class="total-line"><span class="muted">${esc(countLabel(expenses.length))}</span><strong>${formatMoney(total)}</strong></div>
    ${list || `<div class="empty"><div class="empty-icon">${icon("list", 32)}</div><p class="muted">${esc(emptyText)}</p></div>`}
    ${
      s.settlement
        ? `<p class="hint center">${icon("lock", 14)} ${esc(t("settledLockedHint"))}</p>`
        : `<p class="hint center">${esc(t("tapToEdit"))}</p>`
    }`;
}

function inviteUrl(doc) {
  const owner = doc.members.find((m) => m.id === doc.ownerId);
  const query = new URLSearchParams({ c: doc.code, n: doc.name, o: firstName(owner?.name) });
  return `${location.origin}${location.pathname}#/accedi?${query}`;
}

function membersTab(key, doc) {
  const provider = providerOf(key);
  const members = doc.members
    .map(
      (m) => `
      <div class="person">
        ${avatar(m, 42)}
        <div class="person-info">
          <div class="person-top"><strong>${esc(m.name + (m.id === session.user.id ? t("youSuffix") : ""))}</strong>${m.id === doc.ownerId ? `<span class="chip">${esc(t("owner"))}</span>` : ""}</div>
          <small class="muted">${esc(m.id)}</small>
        </div>
      </div>`,
    )
    .join("");

  const access = doc.code
    ? `
      <p class="muted small">${t("codeHint")}</p>
      <div class="code-box"><code>${esc(doc.code)}</code></div>
      <div class="row-actions">
        <button class="btn btn-ghost" id="copy-code">${icon("copy", 18)} ${esc(t("copy"))}</button>
        <button class="btn btn-primary" id="share-invite">${icon("share", 18)} ${esc(t("sendLink"))}</button>
      </div>
      <p class="hint">${esc(t("linkHint"))}</p>`
    : `
      <p class="muted small">${esc(t("noCode"))}</p>
      <button class="btn btn-primary btn-block" id="make-code">${icon("key", 20)} ${esc(t("generateCode"))}</button>`;

  return `
    <section class="card">
      <div class="card-head"><h2>${esc(t("members"))}</h2><span class="muted">${doc.members.length}</span></div>
      ${members}
    </section>

    <section class="card">
      <div class="card-head"><h2>${esc(t("walletCodeTitle"))}</h2></div>
      ${access}
    </section>

    <section class="card">
      <div class="card-head"><h2>${esc(t("whereData"))}</h2></div>
      <div class="info-card flat">
        ${icon("sheet", 20)}
        <p>${t("whereDataText", { storage: esc(storageName(provider)), owner: esc(memberLookup(doc)(doc.ownerId).name) })}</p>
      </div>
      <button class="btn btn-ghost btn-block" id="open-sheet">${icon("external", 18)} ${esc(t("openSheet"))}</button>
    </section>`;
}

function bindWalletActions(key, doc, month) {
  const user = session.user;

  app.querySelector("#settle")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: t("settleTitle", { month: monthYearText(month) }),
      text: t("settleText"),
      ok: t("settleOk"),
    });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), t("saving"), () => mutateWallet(key, (d) => rules.settleMonth(d, user, month)));
      toast(t("monthSettledToast"), "success");
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.querySelector("#reopen")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({ title: t("reopenTitle"), text: t("reopenText"), ok: t("reopen") });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), "", () => mutateWallet(key, (d) => rules.reopenMonth(d, user, month)));
      toast(t("reopenedToast"));
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.querySelector("#copy-code")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(doc.code);
      toast(t("codeCopied"), "success");
    } catch {
      toast(t("copyFailedCode"), "error");
    }
  });

  app.querySelector("#share-invite")?.addEventListener("click", async () => {
    const url = inviteUrl(doc);
    const text = t("shareText", { name: doc.name, code: doc.code });
    if (navigator.share) {
      navigator.share({ title: t("shareTitle", { name: doc.name }), text, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(t("inviteCopied"), "success");
    } catch {
      toast(t("copyFailed"), "error");
    }
  });

  app.querySelector("#make-code")?.addEventListener("click", async (e) => {
    try {
      await busy(e.target.closest("button"), t("sharingSheet"), async () => {
        const code = await driverFor(key).share(key);
        await mutateWallet(key, (d) => {
          d.code = code;
        });
      });
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.querySelector("#open-sheet")?.addEventListener("click", async (e) => {
    // la finestra va aperta subito (nel click), poi le si assegna l'URL
    const win = window.open("", "_blank");
    try {
      const url = await busy(e.target.closest("button"), t("opening"), () => driverFor(key).openUrl(key));
      if (win) win.location.href = url;
      else location.href = url;
    } catch (err) {
      win?.close();
      toast(err.message, "error");
    }
  });
}

// ---------- form spesa ----------

async function viewExpenseForm(key, expenseId, q, stale) {
  loadingScreen(expenseId ? t("editExpense") : t("newExpense"));
  const doc = await openWallet(key, session.user);
  if (!doc || stale()) return;
  const user = session.user;
  const backMonth = q.get("m") || currentMonth();
  const back = walletHref(key, expenseId ? "spese" : "", backMonth);

  const expense = expenseId ? doc.expenses.find((e) => e.id === expenseId) : null;
  if (expenseId && !expense) throw new Error(t("expenseNotFound"));
  if (expense && expense.createdBy !== user.id) throw new Error(t("onlyOwnEdit"));

  const defaultDate = backMonth === currentMonth() ? todayIso() : `${backMonth}-01`;
  const date = expense?.date ?? defaultDate;
  const split = new Set(expense?.splitAmong ?? doc.members.map((m) => m.id));

  const memberChips = doc.members
    .map(
      (m) => `
      <label class="member-chip">
        <input type="checkbox" name="split" value="${esc(m.id)}" ${split.has(m.id) ? "checked" : ""}>
        <span>${avatar(m, 28)}${esc(m.id === user.id ? t("me") : firstName(m.name))}</span>
      </label>`,
    )
    .join("");

  render(`
    <header class="topbar">
      <a class="icon-btn" href="${back}" aria-label="${esc(t("back"))}">${icon("back")}</a>
      <div class="topbar-title"><small class="muted">${esc(doc.name)}</small><h1>${esc(expense ? t("editExpense") : t("newExpense"))}</h1></div>
    </header>
    <form class="page" id="form" novalidate>
      <div class="amount-input">
        <span>€</span>
        <input name="amount" inputmode="decimal" placeholder="${esc(centsToInput(0))}" autocomplete="off" value="${expense ? esc(centsToInput(expense.amountCents)) : ""}" aria-label="${esc(t("amount"))}">
      </div>
      <div class="card form-card">
        <label class="field icon-field">
          ${icon("calendar", 20)}
          <span class="sr-only">${esc(t("date"))}</span>
          <input type="date" name="date" required value="${esc(date)}">
        </label>
        <label class="field icon-field">
          ${icon("note", 20)}
          <span class="sr-only">${esc(t("note"))}</span>
          <input name="note" maxlength="200" placeholder="${esc(t("notePlaceholder"))}" value="${esc(expense?.note ?? "")}" autocomplete="off">
        </label>
      </div>
      <div class="section-head"><h2>${esc(t("splitAmong"))}</h2><small class="muted" id="split-hint"></small></div>
      <div class="member-chips">${memberChips}</div>
      <button class="btn btn-primary btn-block" type="submit">${icon("check", 20)} ${esc(expense ? t("saveChanges") : t("addExpense"))}</button>
      ${expense ? `<button class="btn btn-danger-ghost btn-block" type="button" id="delete">${icon("trash", 18)} ${esc(t("deleteExpense"))}</button>` : ""}
    </form>`);

  const form = app.querySelector("#form");
  if (!expense) form.amount.focus();

  const updateHint = () => {
    const n = form.querySelectorAll("[name=split]:checked").length;
    const cents = parseMoney(form.amount.value);
    app.querySelector("#split-hint").textContent = n && cents ? t("perHead", { amount: formatMoney(Math.round(cents / n)) }) : "";
  };
  form.addEventListener("input", updateHint);
  updateHint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountCents = parseMoney(form.amount.value);
    if (!amountCents || amountCents <= 0) {
      form.amount.focus();
      return toast(t("invalidAmount"), "error");
    }
    if (!form.date.value) return toast(t("dateRequired"), "error");
    const splitAmong = [...form.querySelectorAll("[name=split]:checked")].map((c) => c.value);
    if (!splitAmong.length) return toast(t("pickSomeone"), "error");
    const data = { date: form.date.value, note: form.note.value, amountCents, splitAmong };
    try {
      await busy(form.querySelector("[type=submit]"), t("savingSheet"), () =>
        mutateWallet(key, (d) => (expense ? rules.updateExpense(d, user, expense.id, data) : rules.addExpense(d, user, data))),
      );
      toast(expense ? t("expenseUpdated") : t("expenseAdded"), "success");
      go(walletHref(key, "spese", monthOf(data.date)));
    } catch (err) {
      if (err instanceof AuthRequiredError) return errorScreen(err);
      toast(err.message, "error");
    }
  });

  app.querySelector("#delete")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: t("deleteTitle"),
      text: t("deleteText", { note: expense.note || t("expense"), amount: formatMoney(expense.amountCents) }),
      ok: t("deleteOk"),
      danger: true,
    });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), t("deleting"), () => mutateWallet(key, (d) => rules.deleteExpense(d, user, expense.id)));
      toast(t("expenseDeleted"));
      go(walletHref(key, "spese", monthOf(expense.date)));
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------- avvio ----------

async function boot() {
  document.documentElement.lang = lang;
  try {
    const returnHash = await handleRedirect();
    if (returnHash) {
      session = getSession();
      sessionStorage.removeItem("fw.return");
      if (location.hash !== returnHash) location.hash = returnHash;
    }
  } catch (err) {
    toast(err.message, "error");
  }
  if (session) {
    const hash = startHash(location.hash);
    if (hash !== location.hash) history.replaceState(null, "", hash);
  }
  applyTheme();
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-user-menu]")) openUserMenu();
  });
  window.addEventListener("hashchange", () => route());
  route();
}

boot();
