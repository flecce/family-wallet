// Genera una coppia di chiavi VAPID per le notifiche push: node scripts/vapid-keys.mjs
// La pubblica va nelle variabili (è pubblica), la privata SOLO nei segreti di GitHub/Cloudflare.
import crypto from "node:crypto";

const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
console.log("FW_VAPID_PUBLIC_KEY (variabile) =", ecdh.getPublicKey().toString("base64url"));
console.log("VAPID_PRIVATE_KEY   (segreto)   =", ecdh.getPrivateKey().toString("base64url"));
console.log("\nNon committare la chiave privata e non condividerla.");
