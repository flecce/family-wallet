const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const monthFmt = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const shortDateFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

export const formatMoney = (cents) => euro.format(cents / 100);

/** "12,50" | "12.5" | "1.234,56" -> centesimi, oppure null se non valido */
export function parseMoney(text) {
  let s = String(text).trim().replace(/\s|€/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const centsToInput = (cents) => (cents / 100).toFixed(2).replace(".", ",");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const currentMonth = () => todayIso().slice(0, 7);

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthLabel = (month) => capitalize(monthFmt.format(new Date(`${month}-01T12:00:00`)));
export const dayLabel = (iso) => capitalize(dayFmt.format(new Date(`${iso}T12:00:00`)));
export const dateLabel = (isoOrTs) => shortDateFmt.format(new Date(isoOrTs.length === 10 ? `${isoOrTs}T12:00:00` : isoOrTs));

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return b64url(bytes);
}

export function b64url(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlText(text) {
  return b64url(new TextEncoder().encode(text));
}

export function fromB64urlText(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Hash della password del wallet (PBKDF2-SHA256): nel foglio non finisce mai la password in chiaro. */
export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 150_000 },
    key,
    256,
  );
  return b64url(bits);
}

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Utente";
}

const avatarColors = ["#7B61FF", "#FF7A59", "#20C997", "#F7B731", "#4DABF7", "#F06595", "#845EF7", "#12B886"];

export function avatar(member, size = 40) {
  const name = member?.name || "?";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  let hash = 0;
  for (const c of member?.id || name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const color = avatarColors[hash % avatarColors.length];
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;--av:${color}`;
  if (member?.picture) {
    return `<span class="avatar" style="${style}"><img src="${esc(member.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span>${esc(initials)}</span></span>`;
  }
  return `<span class="avatar" style="${style}"><span>${esc(initials)}</span></span>`;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
