// Novità e notifiche. Senza server non esistono push ad app chiusa: l'app segna (per wallet e
// per utente, in questo browser) fin dove ha già visto le spese degli altri, mostra quelle nuove
// e, mentre è aperta anche in background, ricontrolla il foglio e avvisa con una notifica di sistema.

import { isIos } from "./install.js";

const PREF_KEY = "fw.notify";
const seenKey = (userId, walletKey) => `fw.seen.${userId}.${walletKey}`;

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // storage non disponibile
    }
  },
};

// ---------- novità ----------

const latestCreatedAt = (doc) => doc.expenses.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), "");

/**
 * Spese aggiunte da altri dopo l'ultima volta che l'utente ha segnato le novità come viste.
 * La prima volta che si apre un wallet non c'è nulla di nuovo: si parte da lì.
 */
export function unseenExpenses(doc, userId, walletKey) {
  const seen = storage.get(seenKey(userId, walletKey));
  if (seen === null) {
    storage.set(seenKey(userId, walletKey), latestCreatedAt(doc) || new Date().toISOString());
    return [];
  }
  return doc.expenses
    .filter((e) => e.createdBy !== userId && e.createdAt > seen)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markSeen(doc, userId, walletKey) {
  const previous = storage.get(seenKey(userId, walletKey)) ?? "";
  const latest = latestCreatedAt(doc);
  storage.set(seenKey(userId, walletKey), latest > previous ? latest : previous);
}

// ---------- notifiche di sistema ----------

export const notificationsSupported = () => "Notification" in window && "serviceWorker" in navigator;

/** Su iPhone le notifiche esistono solo per l'app installata nella schermata Home. */
export const notificationsNeedInstall = () => !notificationsSupported() && isIos;

export const notificationsBlocked = () => notificationsSupported() && Notification.permission === "denied";

export const notificationsEnabled = () =>
  notificationsSupported() && Notification.permission === "granted" && storage.get(PREF_KEY) === "on";

/** Chiede il permesso (va chiamata da un click). true se le notifiche sono attive. */
export async function enableNotifications() {
  if (!notificationsSupported()) return false;
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return false;
  storage.set(PREF_KEY, "on");
  return true;
}

export function disableNotifications() {
  storage.set(PREF_KEY, null);
}

export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

/** Notifica di sistema tramite il service worker (su Android `new Notification()` non è permesso). */
export async function showNotification(title, body, { url, tag } = {}) {
  if (!notificationsEnabled()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, { body, tag, icon: "icon.svg", badge: "icon.svg", data: { url } });
  } catch {
    // notifiche non disponibili in questo momento: restano le novità nell'app
  }
}
