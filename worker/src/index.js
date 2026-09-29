// "Postino" delle notifiche push di Family Wallet (Cloudflare Worker).
// Non salva nulla: riceve i destinatari (gli abbonamenti push letti dal foglio del wallet)
// e il testo, verifica che chi chiama sia loggato con Google o Microsoft, firma e spedisce.
//
// Variabili: ALLOWED_ORIGINS, VAPID_PUBLIC_KEY, VAPID_SUBJECT · Segreto: VAPID_PRIVATE_KEY

import { sendPush } from "./webpush.js";

const MAX_SUBSCRIPTIONS = 30;
const MAX_TEXT = 300;

// Solo i servizi di push dei browser: il Worker non deve diventare un modo per chiamare indirizzi qualsiasi
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const isPushEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Provider",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : null;
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

/** Il token deve essere valido presso Google o Microsoft (lo stesso che l'app usa per i fogli). */
async function isSignedIn(request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const provider = request.headers.get("X-Provider");
  if (!token) return false;
  const url =
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : provider === "microsoft"
        ? "https://graph.microsoft.com/v1.0/me?$select=id"
        : null;
  if (!url) return false;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok;
}

const clip = (value) => String(value ?? "").slice(0, MAX_TEXT);

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response("Origine non consentita", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/notify") return json({ error: "not_found" }, 404, cors);
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json({ error: "vapid_not_configured" }, 500, cors);
    if (!(await isSignedIn(request))) return json({ error: "unauthorized" }, 401, cors);

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: "bad_json" }, 400, cors);
    }
    const subscriptions = (Array.isArray(input.subscriptions) ? input.subscriptions : [])
      .filter((s) => isPushEndpoint(s?.endpoint) && s.keys?.p256dh && s.keys?.auth)
      .slice(0, MAX_SUBSCRIPTIONS);
    const payload = {
      title: clip(input.payload?.title),
      body: clip(input.payload?.body),
      url: clip(input.payload?.url),
      tag: clip(input.payload?.tag),
    };

    const vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || "https://github.com/flecce/family-wallet",
    };
    const results = await Promise.all(
      subscriptions.map(async (s) => {
        try {
          return { endpoint: s.endpoint, status: await sendPush(s, payload, vapid) };
        } catch {
          return { endpoint: s.endpoint, status: 0 };
        }
      }),
    );
    // l'app toglie dal foglio gli abbonamenti non più validi (telefono cambiato, notifiche revocate…)
    const gone = results.filter((r) => r.status === 404 || r.status === 410).map((r) => r.endpoint);
    return json({ sent: results.filter((r) => r.status >= 200 && r.status < 300).length, gone }, 200, cors);
  },
};
