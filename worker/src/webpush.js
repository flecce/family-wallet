// Web Push senza dipendenze, solo WebCrypto (funziona in Cloudflare Workers e in Node 20+):
// - firma VAPID (RFC 8292): JWT ES256 firmato con la chiave privata del server
// - cifratura del contenuto "aes128gcm" (RFC 8291 + RFC 8188)

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** HKDF con un solo blocco di output (bastano fino a 32 byte). */
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** Chiave VAPID: pubblica non compressa (65 byte) e privata "d" (32 byte), entrambe base64url. */
async function importVapidPrivateKey(publicKey, privateKey) {
  const pub = b64urlDecode(publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Header Authorization VAPID per il servizio di push che ospita l'endpoint. */
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }) {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
  );
  const key = await importVapidPrivateKey(publicKey, privateKey);
  // WebCrypto restituisce la firma già nel formato r||s richiesto da ES256
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${publicKey}`;
}

/**
 * Cifra il contenuto per un abbonamento (keys.p256dh / keys.auth del browser).
 * `salt` e `serverKeys` si possono passare solo per i test.
 */
export async function encryptPayload(subscriptionKeys, payload, { salt, serverKeys } = {}) {
  const uaPublic = b64urlDecode(subscriptionKeys.p256dh);
  const authSecret = b64urlDecode(subscriptionKeys.auth);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  serverKeys ??= await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));

  // RFC 8291 §3.3-3.4
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // un solo record: contenuto + delimitatore 0x02
  const plaintext = concat(enc.encode(typeof payload === "string" ? payload : JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  // intestazione RFC 8188: salt(16) | dimensione record(4) | lunghezza id(1) | id = chiave pubblica del server
  const recordSize = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** Invia una notifica. Restituisce lo status HTTP del servizio di push (201 = consegnata, 404/410 = abbonamento scaduto). */
export async function sendPush(subscription, payload, vapid, { ttl = 24 * 3600 } = {}) {
  const body = await encryptPayload(subscription.keys, payload);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body,
  });
  return res.status;
}
