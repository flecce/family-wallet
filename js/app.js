import { AuthRequiredError, getAccessToken, getSession, handleRedirect, isConfigured, renewSilently, signIn, signOut } from "./auth.js";
import { monthOf, monthSummary } from "./balance.js";
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
const STORAGE_NAME = { google: "Google Sheets", microsoft: "Excel su OneDrive", demo: "demo (nel browser)" };

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

function confirmDialog({ title, text, ok = "Conferma", danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="sheet-grip"></div>
        <h3 id="dlg-title">${esc(title)}</h3>
        <p class="muted">${esc(text)}</p>
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-v="0">Annulla</button>
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
  const close = () => {
    document.removeEventListener("keydown", onKey);
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

// ---------- menu utente (come le impostazioni di Spendly) ----------

const THEME_OPTIONS = { system: ["Sistema", "monitor"], light: ["Chiaro", "sun"], dark: ["Scuro", "moon"] };

const userButton = () =>
  `<button class="user-btn" data-user-menu aria-label="Menu utente" aria-haspopup="dialog">${avatar(session.user, 40)}</button>`;

function openUserMenu() {
  if (!session) return;
  const user = session.user;
  const inHome = parseHash().seg.length === 0;
  const { el, close } = openSheet(
    `
    <div class="sheet-head">
      <h3>Impostazioni</h3>
      <button class="icon-btn small" data-action="close" aria-label="Chiudi">${icon("close", 18)}</button>
    </div>
    <div class="account-card">
      ${avatar(user, 52)}
      <div>
        <strong>${esc(user.name)}</strong>
        <span class="muted">${esc(user.email)}</span>
        <small class="muted">${session.provider === "demo" ? "Modalità demo" : `Accesso con ${PROVIDER_NAME[session.provider]}`}</small>
      </div>
    </div>

    <div class="menu-label">Tema</div>
    <div class="segmented" role="radiogroup" aria-label="Tema">
      ${THEMES.map(
        (t) =>
          `<button role="radio" aria-checked="${t === theme}" data-theme-choice="${t}">${icon(THEME_OPTIONS[t][1], 18)}<span>${THEME_OPTIONS[t][0]}</span></button>`,
      ).join("")}
    </div>

    <div class="menu-list">
      ${
        canOfferInstall()
          ? `<button class="menu-item" data-action="install">${icon("download", 20)}<span>Installa come app</span>${icon("next", 18)}</button>`
          : ""
      }
      ${inHome ? "" : `<a class="menu-item" href="#/">${icon("wallet", 20)}<span>Tutti i wallet</span>${icon("next", 18)}</a>`}
      <button class="menu-item danger" data-action="logout">${icon("logout", 20)}<span>Esci</span></button>
    </div>`,
    "menu-sheet",
  );

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
    const ok = await confirmDialog({
      title: "Uscire?",
      text: "I wallet restano nei fogli sul cloud: potrai rientrare quando vuoi.",
      ok: "Esci",
      danger: true,
    });
    if (ok) logout();
  });
}

/** Nessun prompt del browser (sempre così su iPhone): si spiegano i passaggi a mano. */
function openInstallHelp() {
  openSheet(`
    <div class="sheet-head">
      <h3>Installa come app</h3>
      <button class="icon-btn small" data-action="close" aria-label="Chiudi">${icon("close", 18)}</button>
    </div>
    <div class="install-help">
      ${logo(56)}
      <p>${
        isIos
          ? `In Safari tocca <strong>Condividi</strong> ${icon("share", 16)} e poi <strong>Aggiungi alla schermata Home</strong>.`
          : `Apri il menu del browser (<strong>⋮</strong>) e scegli <strong>Installa app</strong> o <strong>Aggiungi a schermata Home</strong>.`
      }</p>
      <p class="muted small">Family Wallet si aprirà a tutto schermo, come un'app, dall'icona sulla schermata Home.</p>
    </div>
    <button class="btn btn-primary btn-block" data-action="close">Ho capito</button>`);
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
    ${title ? `<header class="topbar"><a class="icon-btn" href="#/" aria-label="Indietro">${icon("back")}</a><div class="topbar-title"><h1>${esc(title)}</h1></div></header>` : ""}
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
      render(`<div class="page center-page"><span class="spinner big"></span><p class="muted">Riconnessione…</p></div>`);
      return;
    }
    render(`
      <div class="page center-page">
        <div class="empty-icon">${icon("lock", 32)}</div>
        <h2>Sessione scaduta</h2>
        <p class="muted">Per sicurezza l'accesso a ${esc(STORAGE_NAME[session?.provider] ?? "cloud")} dura poco. Riconnettiti per continuare.</p>
        <button class="btn btn-primary btn-block" id="reconnect">${icon("refresh", 20)} Riconnetti</button>
        <button class="btn btn-ghost btn-block" id="logout">Esci</button>
      </div>`);
    app.querySelector("#reconnect").addEventListener("click", async (e) => {
      try {
        await busy(e.target.closest("button"), "Connessione…", () => getAccessToken({ interactive: true }));
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
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="Home">${icon("back")}</a></header>
    <div class="page center-page">
      <div class="empty-icon danger">${icon("sparkle", 32)}</div>
      <h2>Qualcosa è andato storto</h2>
      <p class="muted">${esc(err?.message || err)}</p>
      <button class="btn btn-primary btn-block" id="retry">${icon("refresh", 20)} Riprova</button>
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
    `<a class="nav-item ${active === tab ? "active" : ""}" href="${walletHref(key, tab === "mese" ? "" : tab, month)}">${icon(ic)}<span>${label}</span></a>`;
  return `
    <nav class="bottom-nav">
      <a class="nav-item" href="#/">${icon("home")}<span>Wallet</span></a>
      ${item("mese", "Mese", "chart")}
      <a class="fab" href="${walletHref(key, "nuova", month)}" aria-label="Nuova spesa">${icon("plus", 28)}</a>
      ${item("spese", "Spese", "list")}
      ${item("membri", "Membri", "users")}
    </nav>`;
}

// ---------- router ----------

async function route() {
  const seq = ++renderSeq;
  document.querySelectorAll(".sheet-backdrop").forEach((el) => el.remove()); // chiude eventuali pannelli aperti
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
        throw new Error(`Questo wallet è su ${STORAGE_NAME[providerOf(key)]}: accedi con ${PROVIDER_NAME[providerOf(key)]} per aprirlo.`);
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
  const btn = (provider, logo) => `
    <button class="btn btn-social" data-provider="${provider}" ${isConfigured(provider) ? "" : "disabled"}>
      ${logo}<span>Continua con ${PROVIDER_NAME[provider]}</span>
    </button>`;
  render(`
    <div class="login">
      <div class="login-art" aria-hidden="true">
        <div class="art-card art-card-back"></div>
        <div class="art-card">
          <div class="art-chip"></div>
          <div class="art-label">Spese di famiglia</div>
          <div class="art-amount">€ 1.284,50</div>
          <div class="art-row"><span></span><span></span><span></span></div>
        </div>
        <div class="art-bubble art-bubble-1">${icon("check", 18)} Mese pagato</div>
        <div class="art-bubble art-bubble-2">Selene → Fabiano · 100 €</div>
      </div>
      <div class="login-body">
        <div class="brand">${logo(32)}<span>Family Wallet</span></div>
        <h1>Le spese di casa,<br><span class="accent">divise senza pensieri.</span></h1>
        <p class="muted">Segnate le spese, vedete ogni mese chi deve dare a chi. I dati restano in un foglio sul vostro Google Drive o OneDrive.</p>
        <div class="login-buttons">
          ${btn("google", googleLogo)}
          ${btn("microsoft", microsoftLogo)}
          <button class="btn btn-link" data-provider="demo">Prova la demo senza account</button>
        </div>
        ${
          !isConfigured("google") && !isConfigured("microsoft")
            ? `<p class="hint">Configura gli ID client in <code>js/config.js</code> (vedi README).</p>`
            : ""
        }
      </div>
    </div>`);
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
        <div><small class="muted">Ciao 👋</small><h1>${esc(firstName(user.name))}</h1></div>
      </div>
      ${userButton()}
    </header>`;
  const actions = `
    <div class="home-actions">
      <a class="action-tile action-primary" href="#/new">
        <span class="action-icon">${icon("plus", 24)}</span>
        <strong>Crea wallet</strong>
        <small>Nuovo foglio condiviso</small>
      </a>
      <a class="action-tile" href="#/accedi">
        <span class="action-icon">${icon("key", 24)}</span>
        <strong>Accedi a wallet</strong>
        <small>Con codice e password</small>
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
            <small class="muted">${w.owned ? "Creato da te" : `Condiviso${w.ownerName ? ` da ${esc(w.ownerName)}` : ""}`}</small>
            <small class="default-label">${icon("star", 12)} Si apre all'avvio</small>
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
      <div class="section-head"><h2>I tuoi wallet</h2><span class="muted">${wallets.length}</span></div>
      ${
        wallets.length
          ? `<div class="stack">${cards}</div>`
          : `<div class="empty"><div class="empty-icon">${icon("wallet", 32)}</div><p class="muted">Non hai ancora wallet. Creane uno, oppure entra in quello di un familiare con il codice e la password.</p></div>`
      }
      ${wallets.length ? `<p class="hint center">Tocca la stella per aprire un wallet automaticamente all'avvio.</p>` : ""}
      <p class="hint center">${icon("sheet", 14)} I wallet sono fogli ${esc(STORAGE_NAME[session.provider])}</p>
    </div>`);

  const paintStars = () => {
    app.querySelectorAll(".star-btn").forEach((b) => {
      const active = b.dataset.key === defaultKey;
      b.closest(".wallet-item").classList.toggle("is-default", active);
      b.setAttribute("aria-pressed", String(active));
      b.setAttribute("aria-label", active ? `Non aprire ${b.dataset.name} all'avvio` : `Apri ${b.dataset.name} all'avvio`);
      b.innerHTML = icon("star", 22);
    });
  };
  paintStars();
  app.querySelectorAll(".star-btn").forEach((b) =>
    b.addEventListener("click", () => {
      defaultKey = defaultKey === b.dataset.key ? null : b.dataset.key;
      setDefaultWallet(defaultKey);
      paintStars();
      toast(defaultKey ? `${b.dataset.name} si aprirà all'avvio` : "All'avvio si aprirà l'elenco dei wallet", "success");
    }),
  );
}

// ---------- nuovo wallet ----------

function viewNew() {
  render(`
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="Indietro">${icon("back")}</a><div class="topbar-title"><h1>Nuovo wallet</h1></div></header>
    <form class="page" id="form" novalidate>
      <label class="field">
        <span>Nome del wallet</span>
        <input name="name" required maxlength="50" placeholder="Es. Casa, Vacanze 2026" autocomplete="off">
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password" placeholder="Almeno ${MIN_PASSWORD} caratteri">
      </label>
      <label class="field">
        <span>Ripeti la password</span>
        <input name="password2" type="password" required autocomplete="new-password">
      </label>
      <div class="info-card">
        ${icon("sheet", 20)}
        <p>Verrà creato un foglio <strong>${esc(STORAGE_NAME[session.provider])}</strong> nel tuo ${session.provider === "google" ? "Google Drive" : "OneDrive (cartella App › Family Wallet)"}. Per entrare, gli altri useranno il <strong>codice del wallet</strong> e questa <strong>password</strong>.</p>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${icon("check", 20)} Crea wallet</button>
    </form>`);
  const form = app.querySelector("#form");
  form.name.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const password = form.password.value;
    if (!name) return toast("Dai un nome al wallet", "error");
    if (password.length < MIN_PASSWORD) return toast(`La password deve avere almeno ${MIN_PASSWORD} caratteri`, "error");
    if (password !== form.password2.value) return toast("Le due password non coincidono", "error");
    try {
      const key = await busy(form.querySelector("[type=submit]"), "Creo il foglio…", () =>
        createWallet(session.provider, name, password, session.user),
      );
      toast("Wallet creato! Condividi codice e password", "success");
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
         <div class="hero-label">${message ? "Wallet" : "Sei stato invitato in"}</div>
         <div class="hero-amount">${esc(walletName)}</div>
         ${owner ? `<div class="hero-meta">da ${esc(owner)}</div>` : ""}
       </div>`
    : "";

  if (!session) {
    sessionStorage.setItem("fw.return", location.hash);
    const providers = codeProvider ? [codeProvider] : ["google", "microsoft"];
    render(`
      <div class="page center-page join">
        <div class="brand center-brand">${logo(56)}<span>Family Wallet</span></div>
        ${inviteHero}
        <p class="muted center">Accedi per entrare nel wallet con il codice e la password.</p>
        ${providers
          .map(
            (p) =>
              `<button class="btn btn-social" data-provider="${p}" ${isConfigured(p) ? "" : "disabled"}>${p === "google" ? googleLogo : microsoftLogo}<span>Accedi con ${PROVIDER_NAME[p]}</span></button>`,
          )
          .join("")}
        ${codeProvider ? `<p class="hint center">Il wallet è su ${STORAGE_NAME[codeProvider]}: serve un account ${PROVIDER_NAME[codeProvider]}.</p>` : ""}
      </div>`);
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
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="Indietro">${icon("back")}</a><div class="topbar-title"><h1>Accedi a un wallet</h1></div></header>
    <form class="page" id="form" novalidate>
      ${inviteHero}
      ${message ? `<div class="info-card">${icon("lock", 20)}<p>${esc(message)}</p></div>` : ""}
      ${
        wrongProvider
          ? `<div class="info-card warn">${icon("lock", 20)}<p>Questo wallet è su ${STORAGE_NAME[codeProvider]}, ma hai fatto l'accesso con ${PROVIDER_NAME[session.provider]}.</p></div>
             <button class="btn btn-primary btn-block" type="button" id="switch">Esci e accedi con ${PROVIDER_NAME[codeProvider]}</button>`
          : ""
      }
      <label class="field">
        <span>Codice wallet</span>
        <textarea name="code" rows="2" required spellcheck="false" autocomplete="off" placeholder="Es. G-1AbC…  oppure  M-aHR0…">${esc(code)}</textarea>
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" required autocomplete="current-password">
      </label>
      <button class="btn btn-primary btn-block" type="submit" ${wrongProvider ? "disabled" : ""}>${icon("key", 20)} Entra nel wallet</button>
      <p class="hint center">Il codice e la password te li dà chi ha creato il wallet (li trova nella scheda Membri).</p>
    </form>`);

  const form = app.querySelector("#form");
  (code ? form.password : form.code).focus();
  app.querySelector("#switch")?.addEventListener("click", () => {
    signOut();
    route();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.code.value.trim()) return toast("Inserisci il codice del wallet", "error");
    try {
      const key = await busy(form.querySelector("[type=submit]"), "Entro…", () =>
        joinWithCode(form.code.value, form.password.value, session.user, session.provider),
      );
      toast("Sei dentro! 🎉", "success");
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
      <a class="icon-btn small" href="${walletHref(key, tab === "mese" ? "" : tab, shiftMonth(month, -1))}" aria-label="Mese precedente">${icon("prev", 20)}</a>
      <span>${monthLabel(month)}${summary.settlement ? ` <span class="badge badge-ok">${icon("check", 12)} Pagato</span>` : ""}</span>
      <a class="icon-btn small" href="${walletHref(key, tab === "mese" ? "" : tab, shiftMonth(month, 1))}" aria-label="Mese successivo">${icon("next", 20)}</a>
    </div>`;

  const header = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Tutti i wallet">${icon("back")}</a>
      <div class="topbar-title"><small class="muted">Wallet</small><h1>${esc(doc.name)}</h1></div>
      <button class="icon-btn" id="refresh" aria-label="Aggiorna">${icon("refresh", 20)}</button>
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
  const splitText = e.splitAmong.length === 1 ? `solo ${firstName(member(e.splitAmong[0]).name)}` : `diviso tra ${e.splitAmong.length}`;
  const inner = `
    ${avatar(who, 42)}
    <span class="tx-info">
      <strong>${esc(e.note || "Spesa")}</strong>
      <small class="muted">${esc(mine ? "Tu" : firstName(who.name))} · ${esc(splitText)}</small>
    </span>
    <span class="tx-amount">${formatMoney(e.amountCents)}${mine && locked ? `<small>${icon("lock", 12)}</small>` : ""}</span>`;
  return mine && !locked
    ? `<a class="tx" href="${walletHref(key, `modifica/${e.id}`, month)}">${inner}</a>`
    : `<div class="tx">${inner}</div>`;
}

function monthTab(key, doc, s, member) {
  const me = s.balances.find((b) => b.memberId === session.user.id) ?? { paidCents: 0, shareCents: 0, balanceCents: 0 };
  const monthName = monthLabel(s.month).split(" ")[0].toLowerCase();

  const transfers = s.transfers.length
    ? s.transfers
        .map((t) => {
          const from = member(t.from);
          const to = member(t.to);
          const involved = t.from === session.user.id || t.to === session.user.id;
          return `
          <div class="transfer ${involved ? "me" : ""}">
            <div class="transfer-people">${avatar(from, 36)}<span class="transfer-arrow">${icon("arrow", 16)}</span>${avatar(to, 36)}</div>
            <p><strong>${esc(firstName(from.name))}</strong> deve <strong class="amount">${formatMoney(t.amountCents)}</strong> a <strong>${esc(firstName(to.name))}</strong></p>
          </div>`;
        })
        .join("")
    : `<p class="muted center pad">${s.expenses.length ? "Siete in pari 🎉 Nessuno deve niente a nessuno." : "Nessuna spesa in questo mese."}</p>`;

  const settleBlock = s.settlement
    ? `<div class="settled">
         ${icon("check", 20)}
         <div><strong>Mese pagato</strong><small class="muted">Segnato da ${esc(firstName(member(s.settlement.settledBy).name))} il ${dateLabel(s.settlement.settledAt)}</small></div>
         <button class="btn btn-ghost btn-small" id="reopen">${icon("unlock", 16)} Riapri</button>
       </div>`
    : s.expenses.length
      ? `<button class="btn btn-primary btn-block" id="settle">${icon("check", 20)} Segna ${esc(monthName)} come pagato</button>`
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
            : `<span class="chip">in pari</span>`;
      return `
        <div class="person">
          ${avatar(m, 40)}
          <div class="person-info">
            <div class="person-top"><strong>${esc(b.memberId === session.user.id ? "Tu" : m.name)}</strong>${chip}</div>
            <div class="bar"><span style="width:${Math.round((b.paidCents / maxPaid) * 100)}%"></span></div>
            <small class="muted">Ha pagato ${formatMoney(b.paidCents)} · quota ${formatMoney(b.shareCents)}</small>
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
      <div class="hero-label">Spese di ${esc(monthName)}</div>
      <div class="hero-amount">${formatMoney(s.totalCents)}</div>
      <div class="hero-stats">
        <div><small>Hai pagato</small><strong>${formatMoney(me.paidCents)}</strong></div>
        <div><small>La tua quota</small><strong>${formatMoney(me.shareCents)}</strong></div>
        <div><small>${me.balanceCents >= 0 ? "Devi ricevere" : "Devi dare"}</small><strong>${formatMoney(Math.abs(me.balanceCents))}</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Chi deve dare a chi</h2></div>
      ${transfers}
      ${settleBlock}
    </section>

    ${
      s.balances.length
        ? `<section class="card"><div class="card-head"><h2>Chi ha speso</h2></div>${people}</section>`
        : ""
    }

    ${
      recent
        ? `<div class="section-head"><h2>Ultime spese</h2><a href="${walletHref(key, "spese", s.month)}">Vedi tutte</a></div><div class="card list-card">${recent}</div>`
        : ""
    }`;
}

function expensesTab(key, doc, s, member, q) {
  const filter = q.get("chi");
  const expenses = s.expenses
    .filter((e) => !filter || e.createdBy === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const chips = [
    `<a class="filter ${!filter ? "active" : ""}" href="${walletHref(key, "spese", s.month)}">Tutti</a>`,
    ...doc.members.map(
      (m) =>
        `<a class="filter ${filter === m.id ? "active" : ""}" href="${walletHref(key, "spese", s.month)}&chi=${encodeURIComponent(m.id)}">${esc(m.id === session.user.id ? "Io" : firstName(m.name))}</a>`,
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
      <div class="day-head"><span>${dayLabel(date)}</span><span>${formatMoney(items.reduce((t, e) => t + e.amountCents, 0))}</span></div>
      <div class="card list-card">${items.map((e) => expenseRow(key, e, member, s.month, Boolean(s.settlement))).join("")}</div>`,
    )
    .join("");

  const total = expenses.reduce((t, e) => t + e.amountCents, 0);
  return `
    <div class="filters">${chips}</div>
    <div class="total-line"><span class="muted">${expenses.length} ${expenses.length === 1 ? "spesa" : "spese"}</span><strong>${formatMoney(total)}</strong></div>
    ${
      list ||
      `<div class="empty"><div class="empty-icon">${icon("list", 32)}</div><p class="muted">Nessuna spesa${filter ? " per questa persona" : ""} in ${monthLabel(s.month).toLowerCase()}.</p></div>`
    }
    ${s.settlement ? `<p class="hint center">${icon("lock", 14)} Mese pagato: riaprilo dalla scheda Mese per modificare le spese.</p>` : `<p class="hint center">Tocca una tua spesa per modificarla o cancellarla.</p>`}`;
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
          <div class="person-top"><strong>${esc(m.name)}${m.id === session.user.id ? " (tu)" : ""}</strong>${m.id === doc.ownerId ? `<span class="chip">Proprietario</span>` : ""}</div>
          <small class="muted">${esc(m.id)}</small>
        </div>
      </div>`,
    )
    .join("");

  const access = doc.code
    ? `
      <p class="muted small">Chi vuole entrare tocca <strong>Accedi a wallet</strong>, inserisce questo codice e la password del wallet (diglela a voce o in un messaggio a parte).</p>
      <div class="code-box"><code>${esc(doc.code)}</code></div>
      <div class="row-actions">
        <button class="btn btn-ghost" id="copy-code">${icon("copy", 18)} Copia</button>
        <button class="btn btn-primary" id="share-invite">${icon("share", 18)} Invia link</button>
      </div>
      <p class="hint">Il link apre direttamente "Accedi a wallet" con il codice già inserito. Chi ha il codice può aprire anche il foglio: la password protegge l'ingresso nell'app.</p>`
    : `
      <p class="muted small">Questo wallet non ha ancora un codice di accesso.</p>
      <button class="btn btn-primary btn-block" id="make-code">${icon("key", 20)} Genera codice</button>`;

  return `
    <section class="card">
      <div class="card-head"><h2>Membri</h2><span class="muted">${doc.members.length}</span></div>
      ${members}
    </section>

    <section class="card">
      <div class="card-head"><h2>Codice del wallet</h2></div>
      ${access}
    </section>

    <section class="card">
      <div class="card-head"><h2>Dove sono i dati</h2></div>
      <div class="info-card flat">
        ${icon("sheet", 20)}
        <p>Un foglio ${esc(STORAGE_NAME[provider])} nel cloud di <strong>${esc(memberLookup(doc)(doc.ownerId).name)}</strong>. Fogli: Spese, Membri, Mesi pagati, Info.</p>
      </div>
      <button class="btn btn-ghost btn-block" id="open-sheet">${icon("external", 18)} Apri il foglio</button>
    </section>`;
}


function bindWalletActions(key, doc, month) {
  const user = session.user;

  app.querySelector("#settle")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: `Segnare ${monthLabel(month).toLowerCase()} come pagato?`,
      text: "Confermi che i pagamenti del mese sono stati fatti. Le spese del mese non si potranno più modificare, a meno di riaprirlo.",
      ok: "Segna come pagato",
    });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), "Salvo…", () => mutateWallet(key, (d) => rules.settleMonth(d, user, month)));
      toast("Mese segnato come pagato", "success");
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.querySelector("#reopen")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: "Riaprire il mese?",
      text: "Il mese tornerà da pagare e le spese si potranno di nuovo modificare.",
      ok: "Riapri",
    });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), "", () => mutateWallet(key, (d) => rules.reopenMonth(d, user, month)));
      toast("Mese riaperto");
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.querySelector("#copy-code")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(doc.code);
      toast("Codice copiato", "success");
    } catch {
      toast("Copia non riuscita: seleziona il codice a mano", "error");
    }
  });

  app.querySelector("#share-invite")?.addEventListener("click", async () => {
    const url = inviteUrl(doc);
    const text = `Entra nel wallet "${doc.name}" su Family Wallet. Codice: ${doc.code}`;
    if (navigator.share) {
      navigator.share({ title: `Unisciti a ${doc.name}`, text, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link di invito copiato", "success");
    } catch {
      toast("Copia non riuscita", "error");
    }
  });

  app.querySelector("#make-code")?.addEventListener("click", async (e) => {
    try {
      await busy(e.target.closest("button"), "Condivido il foglio…", async () => {
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
      const url = await busy(e.target.closest("button"), "Apro…", () => driverFor(key).openUrl(key));
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
  loadingScreen(expenseId ? "Modifica spesa" : "Nuova spesa");
  const doc = await openWallet(key, session.user);
  if (!doc || stale()) return;
  const user = session.user;
  const backMonth = q.get("m") || currentMonth();
  const back = walletHref(key, expenseId ? "spese" : "", backMonth);

  const expense = expenseId ? doc.expenses.find((e) => e.id === expenseId) : null;
  if (expenseId && !expense) throw new Error("Spesa non trovata: forse è stata cancellata");
  if (expense && expense.createdBy !== user.id) throw new Error("Puoi modificare solo le spese che hai inserito tu");

  const defaultDate = backMonth === currentMonth() ? todayIso() : `${backMonth}-01`;
  const date = expense?.date ?? defaultDate;
  const split = new Set(expense?.splitAmong ?? doc.members.map((m) => m.id));

  const memberChips = doc.members
    .map(
      (m) => `
      <label class="member-chip">
        <input type="checkbox" name="split" value="${esc(m.id)}" ${split.has(m.id) ? "checked" : ""}>
        <span>${avatar(m, 28)}${esc(m.id === user.id ? "Io" : firstName(m.name))}</span>
      </label>`,
    )
    .join("");

  render(`
    <header class="topbar">
      <a class="icon-btn" href="${back}" aria-label="Indietro">${icon("back")}</a>
      <div class="topbar-title"><small class="muted">${esc(doc.name)}</small><h1>${expense ? "Modifica spesa" : "Nuova spesa"}</h1></div>
    </header>
    <form class="page" id="form" novalidate>
      <div class="amount-input">
        <span>€</span>
        <input name="amount" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${expense ? centsToInput(expense.amountCents) : ""}" aria-label="Importo">
      </div>
      <div class="card form-card">
        <label class="field icon-field">
          ${icon("calendar", 20)}
          <span class="sr-only">Data</span>
          <input type="date" name="date" required value="${esc(date)}">
        </label>
        <label class="field icon-field">
          ${icon("note", 20)}
          <span class="sr-only">Nota</span>
          <input name="note" maxlength="200" placeholder="Nota (es. Spesa al supermercato)" value="${esc(expense?.note ?? "")}" autocomplete="off">
        </label>
      </div>
      <div class="section-head"><h2>Divisa tra</h2><small class="muted" id="split-hint"></small></div>
      <div class="member-chips">${memberChips}</div>
      <button class="btn btn-primary btn-block" type="submit">${icon("check", 20)} ${expense ? "Salva modifiche" : "Aggiungi spesa"}</button>
      ${expense ? `<button class="btn btn-danger-ghost btn-block" type="button" id="delete">${icon("trash", 18)} Cancella spesa</button>` : ""}
    </form>`);

  const form = app.querySelector("#form");
  if (!expense) form.amount.focus();

  const updateHint = () => {
    const n = form.querySelectorAll("[name=split]:checked").length;
    const cents = parseMoney(form.amount.value);
    app.querySelector("#split-hint").textContent = n && cents ? `${formatMoney(Math.round(cents / n))} a testa` : "";
  };
  form.addEventListener("input", updateHint);
  updateHint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountCents = parseMoney(form.amount.value);
    if (!amountCents || amountCents <= 0) {
      form.amount.focus();
      return toast("Inserisci un importo valido", "error");
    }
    if (!form.date.value) return toast("Inserisci la data", "error");
    const splitAmong = [...form.querySelectorAll("[name=split]:checked")].map((c) => c.value);
    if (!splitAmong.length) return toast("Scegli almeno una persona", "error");
    const data = { date: form.date.value, note: form.note.value, amountCents, splitAmong };
    try {
      await busy(form.querySelector("[type=submit]"), "Salvo nel foglio…", () =>
        mutateWallet(key, (d) => (expense ? rules.updateExpense(d, user, expense.id, data) : rules.addExpense(d, user, data))),
      );
      toast(expense ? "Spesa aggiornata" : "Spesa aggiunta", "success");
      go(walletHref(key, "spese", monthOf(data.date)));
    } catch (err) {
      if (err instanceof AuthRequiredError) return errorScreen(err);
      toast(err.message, "error");
    }
  });

  app.querySelector("#delete")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: "Cancellare la spesa?",
      text: `${expense.note || "Spesa"} · ${formatMoney(expense.amountCents)}. L'operazione non si può annullare.`,
      ok: "Cancella",
      danger: true,
    });
    if (!ok) return;
    try {
      await busy(e.target.closest("button"), "Cancello…", () => mutateWallet(key, (d) => rules.deleteExpense(d, user, expense.id)));
      toast("Spesa cancellata");
      go(walletHref(key, "spese", monthOf(expense.date)));
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------- avvio ----------

async function boot() {
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
  window.addEventListener("hashchange", route);
  route();
}

boot();
