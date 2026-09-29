// Configurazione pubblica dell'app: questi valori finiscono nel browser, NON sono segreti.
// In alternativa si possono impostare come variabili di GitHub Actions (vedi README.md).
window.FAMILY_WALLET_CONFIG = {
  google: {
    // Google Cloud Console -> Google Auth Platform -> Client -> ID client OAuth (Applicazione web)
    clientId: "",
  },
  microsoft: {
    // Microsoft Entra -> Registrazioni app -> ID applicazione (client), piattaforma "Applicazione a pagina singola"
    clientId: "",
  },
  push: {
    // Indirizzo del Worker Cloudflare delle notifiche (es. https://family-wallet-push.<account>.workers.dev)
    workerUrl: "",
    // Chiave pubblica VAPID (node scripts/vapid-keys.mjs): la privata va solo nei segreti
    vapidPublicKey: "",
  },
};
