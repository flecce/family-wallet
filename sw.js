// Service worker minimo: mostra le notifiche (anche quelle push ad app chiusa) e apre l'app quando le si tocca.
// Non intercetta le richieste e non mette nulla in cache (gli aggiornamenti arrivano con i file hashati).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Notifica push inviata dal Worker quando un altro membro aggiunge una spesa
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Family Wallet", {
      body: data.body || "",
      tag: data.tag || undefined, // stessa spesa = stessa notifica (niente doppioni con l'avviso ad app aperta)
      icon: "icon.svg",
      badge: "icon.svg",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) return open.navigate(url).then((w) => (w ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
