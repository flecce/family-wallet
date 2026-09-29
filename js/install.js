// "Installa come app" su telefono e tablet. Android/Chrome fornisce un prompt di installazione
// (beforeinstallprompt) da intercettare subito; su iOS non c'è un'API, quindi si spiegano i passaggi.

let deferred = null;
let installed = false;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // niente mini-barra del browser: l'installazione si offre dal menu utente
  deferred = e;
});
window.addEventListener("appinstalled", () => {
  installed = true;
  deferred = null;
});

const ua = navigator.userAgent;
// iPadOS si presenta come Mac, ma ha il touch
export const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isMobile = isIos || /Android|Mobi/i.test(ua);

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Ha senso proporla: su telefono/tablet, nel browser, non già installata (o se il browser offre il prompt). */
export const canOfferInstall = () => !installed && !isStandalone() && (isMobile || deferred !== null);

/** Mostra il prompt del browser. false se non c'è (servono i passaggi manuali). */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; // un prompt si può usare una volta sola
  await e.prompt();
  if ((await e.userChoice).outcome === "accepted") installed = true;
  return true;
}
