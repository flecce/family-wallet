import { b64url } from "./util.js";
import { t } from "./i18n.js";

// Login interamente nel browser, a redirect (niente popup: funziona anche nell'app installata sul telefono).
// - Google: OAuth 2.0 per app client-side (token nel frammento #access_token=…), serve solo il Client ID.
//   Il token dura ~1 ora; alla scadenza l'app fa un redirect silenzioso (prompt=none).
// - Microsoft: authorization code + PKCE, come "applicazione a pagina singola".

const cfg = window.FAMILY_WALLET_CONFIG;

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
// drive.file: i fogli creati dall'app (elenco, condivisione) · spreadsheets: aprire i fogli condivisi da altri
const GOOGLE_REQUIRED = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/spreadsheets"];
const GOOGLE_SCOPES = `openid email profile ${GOOGLE_REQUIRED.join(" ")}`;

const MS_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MS_SCOPES = "openid profile email offline_access User.Read Files.ReadWrite.All";

const LS_SESSION = "fw.session";
const LS_TOKEN = "fw.token";
const LS_GOOGLE_STATE = "fw.google.state";

export class AuthRequiredError extends Error {
  constructor(message = t("sessionExpiredShort")) {
    super(message);
  }
}

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const randomString = (bytes = 16) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const isConfigured = (provider) =>
  provider === "google" ? Boolean(cfg.google.clientId) : Boolean(cfg.microsoft.clientId);

/** { provider, user: { id, email, name, picture } } oppure null */
export const getSession = () => readJson(LS_SESSION);

export function signOut() {
  localStorage.removeItem(LS_SESSION);
  localStorage.removeItem(LS_TOKEN);
}

export function clearAccessToken() {
  const token = readJson(LS_TOKEN);
  if (token) writeJson(LS_TOKEN, { ...token, expiresAt: 0 });
}

function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

const leavingPage = () => new Promise(() => {}); // la pagina sta per essere sostituita dal redirect

// ---------- Google ----------

function googleRedirect({ silent = false, hint } = {}) {
  const state = randomString();
  localStorage.setItem(LS_GOOGLE_STATE, state);
  const params = new URLSearchParams({
    client_id: cfg.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: "true",
  });
  if (silent) params.set("prompt", "none");
  else if (!hint) params.set("prompt", "select_account");
  if (hint) params.set("login_hint", hint);
  location.assign(`${GOOGLE_AUTH}?${params}`);
  return leavingPage();
}

async function googleProfile(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(t("profileFailed"));
  const p = await res.json();
  return { id: p.email.toLowerCase(), email: p.email, name: p.name || p.email, picture: p.picture };
}

/** Ritorno da Google: #access_token=…&state=… oppure #error=…&state=… */
async function completeGoogle(p, returnHash) {
  const expected = localStorage.getItem(LS_GOOGLE_STATE);
  localStorage.removeItem(LS_GOOGLE_STATE);
  if (!expected || p.get("state") !== expected) throw new Error(t("loginInvalid"));

  const error = p.get("error");
  if (error) {
    if (["interaction_required", "login_required", "consent_required", "account_selection_required"].includes(error)) {
      // il rinnovo silenzioso non è riuscito: serve un login vero
      signOut();
      throw new Error(t("signInAgainGoogle"));
    }
    throw new Error(error === "access_denied" ? t("accessCancelled") : t("loginFailed", { error }));
  }
  const granted = (p.get("scope") ?? "").split(" ");
  if (!GOOGLE_REQUIRED.every((s) => granted.includes(s))) {
    throw new Error(t("googleScopes"));
  }

  const accessToken = p.get("access_token");
  const user = await googleProfile(accessToken);
  writeJson(LS_TOKEN, { accessToken, expiresAt: Date.now() + (Number(p.get("expires_in") ?? 3600) - 60) * 1000 });
  writeJson(LS_SESSION, { provider: "google", user });
  return returnHash;
}

/**
 * Token Google scaduto: rinnova con un redirect silenzioso (una volta al minuto al massimo,
 * per non entrare in un ciclo se Google chiede di nuovo il consenso). true se il redirect è partito.
 */
export function renewSilently() {
  const session = getSession();
  if (session?.provider !== "google") return false;
  const last = Number(sessionStorage.getItem("fw.google.renew") ?? 0);
  if (Date.now() - last < 60_000) return false;
  sessionStorage.setItem("fw.google.renew", String(Date.now()));
  sessionStorage.setItem("fw.return", location.hash || "#/");
  googleRedirect({ silent: true, hint: session.user.email });
  return true;
}

// ---------- Microsoft ----------

async function microsoftRedirect(hint) {
  const verifier = randomString(32);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomString();
  sessionStorage.setItem("fw.ms", JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: cfg.microsoft.clientId,
    response_type: "code",
    response_mode: "query",
    redirect_uri: redirectUri(),
    scope: MS_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (hint) params.set("login_hint", hint);
  location.assign(`${MS_AUTHORITY}/authorize?${params}`);
  return leavingPage();
}

async function microsoftToken(body) {
  const res = await fetch(`${MS_AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.microsoft.clientId, scope: MS_SCOPES, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description?.split("\r\n")[0] || json.error || t("loginFailed", { error: res.status }));
  writeJson(LS_TOKEN, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  });
  return json.access_token;
}

async function microsoftProfile(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(t("profileFailed"));
  const p = await res.json();
  const email = p.mail || p.userPrincipalName;
  return { id: email.toLowerCase(), email, name: p.displayName || email };
}

/** Ritorno da Microsoft: ?code=…&state=… */
async function completeMicrosoft(params, returnHash) {
  if (params.has("error")) throw new Error(params.get("error_description") || params.get("error"));
  const pending = JSON.parse(sessionStorage.getItem("fw.ms") || "null");
  sessionStorage.removeItem("fw.ms");
  if (!pending || pending.state !== params.get("state")) throw new Error(t("loginInvalid"));

  const token = await microsoftToken({
    grant_type: "authorization_code",
    code: params.get("code"),
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  writeJson(LS_SESSION, { provider: "microsoft", user: await microsoftProfile(token) });
  return returnHash;
}

// ---------- API comune ----------

/** Completa un eventuale ritorno dal login. Restituisce l'hash a cui tornare, o null se non è un ritorno. */
export async function handleRedirect() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const isGoogle = hash.has("state") && (hash.has("access_token") || hash.has("error"));
  const isMicrosoft = query.has("code") || query.has("error");
  if (!isGoogle && !isMicrosoft) return null;

  const returnHash = sessionStorage.getItem("fw.return") || "#/";
  sessionStorage.removeItem("fw.return");
  history.replaceState(null, "", redirectUri() + returnHash); // toglie token e codici dall'indirizzo
  return isGoogle ? completeGoogle(hash, returnHash) : completeMicrosoft(query, returnHash);
}

/** Avvia il login (redirect alla pagina di Google o Microsoft). La demo invece entra subito. */
export async function signIn(provider, returnHash = "#/") {
  sessionStorage.setItem("fw.return", returnHash);
  if (provider === "demo") {
    const { DEMO_USER, seedDemo } = await import("./driver-demo.js");
    seedDemo();
    writeJson(LS_SESSION, { provider: "demo", user: DEMO_USER });
    return;
  }
  if (provider === "google") return googleRedirect();
  return microsoftRedirect();
}

/**
 * Access token valido per le API di Google/Microsoft.
 * Con interactive=false non lascia mai la pagina: se serve un nuovo login lancia AuthRequiredError.
 */
export async function getAccessToken({ interactive = false } = {}) {
  const token = readJson(LS_TOKEN);
  if (token?.accessToken && token.expiresAt > Date.now()) return token.accessToken;

  const session = getSession();
  if (!session) throw new AuthRequiredError(t("loginToContinue"));
  if (session.provider === "demo") return "demo";

  if (session.provider === "microsoft" && token?.refreshToken) {
    try {
      return await microsoftToken({ grant_type: "refresh_token", refresh_token: token.refreshToken });
    } catch {
      // refresh token scaduto (dopo 24 ore per le app a pagina singola): serve un nuovo login
    }
  }
  if (!interactive) throw new AuthRequiredError();

  sessionStorage.setItem("fw.return", location.hash || "#/");
  return session.provider === "google"
    ? googleRedirect({ hint: session.user.email })
    : microsoftRedirect(session.user.email);
}
