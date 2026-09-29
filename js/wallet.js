import { monthOf, monthSummary } from "./balance.js";
import { demoDriver } from "./driver-demo.js";
import { googleDriver } from "./driver-google.js";
import { microsoftDriver } from "./driver-microsoft.js";
import { docToTables, tablesToDoc } from "./sheet-model.js";
import { hashPassword, uid } from "./util.js";

const drivers = { google: googleDriver, microsoft: microsoftDriver, demo: demoDriver };
const keyPrefix = { "g.": "google", "m~": "microsoft", "d.": "demo" };

export const driverForProvider = (provider) => drivers[provider];
export function driverFor(key) {
  const provider = keyPrefix[key.slice(0, 2)];
  if (!provider) throw new Error("Indirizzo del wallet non valido");
  return drivers[provider];
}
export const providerOf = (key) => driverFor(key).provider;

const CACHE_MS = 15_000;
const cache = new Map(); // key -> { doc, at }

export async function loadWallet(key, { fresh = false } = {}) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.doc;
  const doc = tablesToDoc(await driverFor(key).readTables(key));
  cache.set(key, { doc, at: Date.now() });
  return doc;
}

/**
 * Rilegge il foglio, applica la modifica e riscrive solo i fogli cambiati.
 * Rileggere subito prima di scrivere riduce il rischio di sovrascrivere modifiche altrui.
 */
export async function mutateWallet(key, change) {
  const driver = driverFor(key);
  const tables = await driver.readTables(key);
  const doc = tablesToDoc(tables);
  const result = change(doc);
  await driver.writeTables(key, docToTables(doc), tables);
  cache.set(key, { doc, at: Date.now() });
  return result;
}

export const MIN_PASSWORD = 6;

export async function createWallet(provider, name, password, user) {
  if (password.length < MIN_PASSWORD) throw new Error(`La password deve avere almeno ${MIN_PASSWORD} caratteri`);
  const now = new Date().toISOString();
  const salt = uid();
  const doc = {
    id: uid(),
    name,
    currency: "EUR",
    createdAt: now,
    ownerId: user.id,
    password: { salt, hash: await hashPassword(password, salt) },
    members: [{ id: user.id, name: user.name, picture: user.picture, joinedAt: now }],
    expenses: [],
    settlements: [],
  };
  const driver = driverForProvider(provider);
  const key = await driver.create(name, docToTables(doc));
  const code = await driver.share(key);
  await mutateWallet(key, (d) => {
    d.code = code;
  });
  return key;
}

export const providerOfCode = (code) => ({ "G-": "google", "M-": "microsoft", "D-": "demo" })[code.slice(0, 2)] ?? null;

/** Errore lanciato quando si apre un wallet a cui si ha accesso al file ma di cui non si è membri. */
export class NotMemberError extends Error {
  constructor(doc) {
    super("Inserisci la password per entrare in questo wallet");
    this.doc = doc;
  }
}

async function checkPassword(doc, password) {
  if (!doc.password) return true; // wallet senza password (creato a mano): basta il codice
  return (await hashPassword(password, doc.password.salt)) === doc.password.hash;
}

/**
 * "Accedi a wallet": dal codice (+ password) all'ingresso nel wallet.
 * La password è un controllo dell'app: il foglio resta accessibile a chi ha il codice.
 */
export async function joinWithCode(rawCode, password, user, userProvider) {
  const code = rawCode.trim().replace(/\s+/g, "");
  const provider = providerOfCode(code);
  if (!provider) throw new Error("Codice wallet non valido: deve iniziare con G- o M-");
  if (provider !== userProvider) {
    throw new Error(
      {
        google: "Questo wallet è su Google Sheets: accedi con Google per entrarci",
        microsoft: "Questo wallet è su Excel/OneDrive: accedi con Microsoft per entrarci",
        demo: "Questo è un codice della demo",
      }[provider],
    );
  }
  const driver = driverForProvider(provider);
  const key = await driver.resolveCode(code);
  const doc = await loadWallet(key, { fresh: true });
  if (!doc.members.some((m) => m.id === user.id)) {
    if (!(await checkPassword(doc, password))) throw new Error("Password errata");
    await mutateWallet(key, (d) => rules.ensureMember(d, user));
  }
  const owner = doc.members.find((m) => m.id === doc.ownerId);
  await driver.remember(key, doc.name, owner?.name);
  return key;
}

/** Carica il wallet verificando che l'utente ne faccia parte. */
export async function openWallet(key, user) {
  const doc = await loadWallet(key);
  if (!doc.members.some((m) => m.id === user.id)) throw new NotMemberError(doc);
  return doc;
}

// ---------- regole sul documento (usate dentro mutateWallet) ----------

function assertMonthOpen(doc, date) {
  if (doc.settlements.some((s) => s.month === monthOf(date))) {
    throw new Error("Questo mese è già segnato come pagato: riaprilo per modificare le spese");
  }
}

function validExpense({ date, note, amountCents, splitAmong }, doc) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data non valida");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Importo non valido");
  const members = new Set(doc.members.map((m) => m.id));
  const split = [...new Set(splitAmong)].filter((id) => members.has(id));
  if (split.length === 0) throw new Error("Scegli almeno una persona tra cui dividere la spesa");
  return { date, note: note.trim().slice(0, 200), amountCents, splitAmong: split };
}

export const rules = {
  /** Aggiunge l'utente ai membri se non c'è; aggiorna nome/foto se cambiati. */
  ensureMember(doc, user) {
    const existing = doc.members.find((m) => m.id === user.id);
    if (existing) {
      const changed = existing.name !== user.name || (user.picture && existing.picture !== user.picture);
      existing.name = user.name;
      if (user.picture) existing.picture = user.picture;
      return changed;
    }
    doc.members.push({ id: user.id, name: user.name, picture: user.picture, joinedAt: new Date().toISOString() });
    return true;
  },

  addExpense(doc, user, input) {
    const data = validExpense(input, doc);
    assertMonthOpen(doc, data.date);
    const now = new Date().toISOString();
    doc.expenses.push({ id: `e_${uid()}`, ...data, createdBy: user.id, createdAt: now, updatedAt: now });
  },

  updateExpense(doc, user, id, input) {
    const expense = doc.expenses.find((e) => e.id === id);
    if (!expense) throw new Error("Spesa non trovata: forse è stata cancellata");
    if (expense.createdBy !== user.id) throw new Error("Puoi modificare solo le spese che hai inserito tu");
    const data = validExpense(input, doc);
    assertMonthOpen(doc, expense.date);
    assertMonthOpen(doc, data.date);
    Object.assign(expense, data, { updatedAt: new Date().toISOString() });
  },

  deleteExpense(doc, user, id) {
    const index = doc.expenses.findIndex((e) => e.id === id);
    if (index < 0) return;
    if (doc.expenses[index].createdBy !== user.id) throw new Error("Puoi cancellare solo le spese che hai inserito tu");
    assertMonthOpen(doc, doc.expenses[index].date);
    doc.expenses.splice(index, 1);
  },

  settleMonth(doc, user, month) {
    if (doc.settlements.some((s) => s.month === month)) return;
    doc.settlements.push({
      month,
      settledBy: user.id,
      settledAt: new Date().toISOString(),
      transfers: monthSummary(doc, month).transfers,
    });
  },

  reopenMonth(doc, _user, month) {
    doc.settlements = doc.settlements.filter((s) => s.month !== month);
  },
};
