// Tema: segue il sistema finché l'utente non ne sceglie uno. La scelta sta su <html data-theme>,
// a cui fanno riferimento i colori in css/style.css. index.html la applica già prima del primo disegno.

export const THEMES = ["system", "light", "dark"];

const THEME_KEY = "fw.theme";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage non disponibile
  }
  return "system";
}

export let theme = savedTheme();

/** Applica la scelta su <html>; la barra del browser segue lo sfondo della pagina. */
export function applyTheme() {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (bg) for (const meta of document.querySelectorAll("meta[name=theme-color]")) meta.content = bg;
}

export function setTheme(next) {
  theme = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // storage non disponibile: vale solo per questa visita
  }
  applyTheme();
}

darkQuery.addEventListener("change", () => {
  if (theme === "system") applyTheme();
});
