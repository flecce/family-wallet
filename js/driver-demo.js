// Modalità demo: il "foglio" vive nel localStorage del browser.
// Serve per provare l'app senza configurare Google o Microsoft.

import { docToTables, tablesToDoc } from "./sheet-model.js";
import { HttpError, currentMonth, shiftMonth, uid } from "./util.js";
import { t } from "./i18n.js";

const LS = "fw.demo.sheets";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(LS)) ?? {};
  } catch {
    return {};
  }
};
const save = (all) => localStorage.setItem(LS, JSON.stringify(all));

export const DEMO_USER = { id: "fabiano@demo.it", email: "fabiano@demo.it", name: "Fabiano Demo" };

/** Crea un wallet di esempio con due membri e qualche spesa, se non ce ne sono. */
export function seedDemo() {
  if (Object.keys(load()).length) return;
  const now = new Date().toISOString();
  const month = currentMonth();
  const prev = shiftMonth(month, -1);
  const selene = "selene@demo.it";
  const both = [DEMO_USER.id, selene];
  const e = (date, note, euro, by, split = both) => ({
    id: `e_${uid()}`,
    date,
    note,
    amountCents: Math.round(euro * 100),
    createdBy: by,
    splitAmong: split,
    createdAt: now,
    updatedAt: now,
  });
  const key = `d.${uid()}`;
  const doc = {
    id: uid(),
    name: "Casa",
    currency: "EUR",
    createdAt: now,
    ownerId: DEMO_USER.id,
    code: `D-${key.slice(2)}`,
    members: [
      { id: DEMO_USER.id, name: DEMO_USER.name, joinedAt: now },
      { id: selene, name: "Selene Demo", joinedAt: now },
    ],
    expenses: [
      e(`${prev}-03`, "Bolletta luce", 86.4, selene),
      e(`${prev}-12`, "Spesa Esselunga", 124.3, DEMO_USER.id),
      e(`${prev}-20`, "Pizza sabato", 38, selene),
      e(`${month}-02`, "Affitto garage", 120, selene),
      e(`${month}-05`, "Spesa settimanale", 96.75, DEMO_USER.id),
      e(`${month}-09`, "Farmacia", 23.9, DEMO_USER.id),
      e(`${month}-14`, "Regalo compleanno nonna", 60, selene),
      e(`${month}-18`, "Benzina", 55, DEMO_USER.id, [DEMO_USER.id]),
      e(`${month}-21`, "Cena fuori", 184, selene),
    ],
    settlements: [{ month: prev, settledBy: selene, settledAt: now, transfers: [] }],
  };
  save({ [key]: docToTables(doc) });
}

export const demoDriver = {
  provider: "demo",
  storageName: "Demo (salvato nel browser)",
  async list() {
    return Object.entries(load()).map(([key, tables]) => ({ key, name: tablesToDoc(tables).name, owned: true }));
  },
  async create(_name, tables) {
    const key = `d.${uid()}`;
    save({ ...load(), [key]: tables });
    return key;
  },
  async readTables(key) {
    const tables = load()[key];
    if (!tables) throw new HttpError(404, "Wallet demo non trovato");
    return structuredClone(tables);
  },
  async writeTables(key, tables) {
    save({ ...load(), [key]: tables });
  },
  async share(key) {
    return `D-${key.slice(2)}`;
  },
  async resolveCode(code) {
    const key = `d.${code.slice(2)}`;
    if (!load()[key]) throw new Error(t("walletNotFound"));
    return key;
  },
  async remember() {},
  async openUrl() {
    throw new Error(t("demoNoSheet"));
  },
};
