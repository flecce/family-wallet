// Il wallet è un foglio di calcolo (Google Sheets o Excel) con quattro fogli.
// Questo modulo converte il documento in memoria <-> righe dei fogli.

import { t } from "./i18n.js";

// il contenuto del foglio resta in italiano, qualunque sia la lingua dell'app
const sheetMoney = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const formatMoney = (cents) => sheetMoney.format(cents / 100);

export const SHEETS = {
  expenses: {
    title: "Spese",
    header: ["ID", "Data", "Nota", "Importo (€)", "Pagato da (email)", "Pagato da", "Diviso tra", "Creata il", "Modificata il"],
    textColumns: [0, 1, 2, 4, 5, 6, 7, 8],
  },
  members: {
    title: "Membri",
    header: ["Email", "Nome", "Foto", "Entrato il"],
    textColumns: [0, 1, 2, 3],
  },
  settlements: {
    title: "Mesi pagati",
    header: ["Mese", "Segnato da (email)", "Segnato il", "Pagamenti", "Dettaglio (JSON)"],
    textColumns: [0, 1, 2, 3, 4],
  },
  info: {
    title: "Info",
    header: ["Chiave", "Valore"],
    textColumns: [0, 1],
  },
};

export const SHEET_LIST = Object.values(SHEETS);
export const APP_MARKER = "family-wallet";

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Excel può convertire testi come "2026-09-29" in numeri seriali: li riportiamo a stringa.
const serialToDate = (n) => new Date(Math.round((n - 25569) * 86400000));
const cellDate = (v) => (typeof v === "number" ? serialToDate(v).toISOString().slice(0, 10) : str(v).slice(0, 10));
const cellMonth = (v) => (typeof v === "number" ? serialToDate(v).toISOString().slice(0, 7) : str(v).slice(0, 7));
const cellTimestamp = (v) => (typeof v === "number" ? serialToDate(v).toISOString() : str(v));
const cellCents = (v) => {
  if (typeof v === "number") return Math.round(v * 100);
  const n = Number(str(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const idList = (v) =>
  str(v)
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const nonEmpty = (rows) => rows.filter((r) => r.some((c) => str(c) !== ""));

export function docToTables(doc) {
  const nameOf = (id) => doc.members.find((m) => m.id === id)?.name ?? id;
  return {
    [SHEETS.expenses.title]: [
      SHEETS.expenses.header,
      ...[...doc.expenses]
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
        .map((e) => [
          e.id,
          e.date,
          e.note,
          e.amountCents / 100,
          e.createdBy,
          nameOf(e.createdBy),
          e.splitAmong.join("; "),
          e.createdAt,
          e.updatedAt,
        ]),
    ],
    [SHEETS.members.title]: [
      SHEETS.members.header,
      ...doc.members.map((m) => [m.id, m.name, m.picture ?? "", m.joinedAt]),
    ],
    [SHEETS.settlements.title]: [
      SHEETS.settlements.header,
      ...[...doc.settlements]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((s) => [
          s.month,
          s.settledBy,
          s.settledAt,
          s.transfers.length
            ? s.transfers.map((t) => `${nameOf(t.from)} → ${nameOf(t.to)}: ${formatMoney(t.amountCents)}`).join("; ")
            : "In pari",
          JSON.stringify(s.transfers),
        ]),
    ],
    [SHEETS.info.title]: [
      SHEETS.info.header,
      ["app", APP_MARKER],
      ["version", "1"],
      ["id", doc.id],
      ["name", doc.name],
      ["currency", doc.currency],
      ["createdAt", doc.createdAt],
      ["ownerId", doc.ownerId],
      ["code", doc.code ?? ""],
      ["passwordSalt", doc.password?.salt ?? ""],
      ["passwordHash", doc.password?.hash ?? ""],
    ],
  };
}

export function tablesToDoc(tables) {
  const body = (sheet) => nonEmpty((tables[sheet.title] ?? []).slice(1));
  const info = Object.fromEntries(body(SHEETS.info).map((r) => [str(r[0]), str(r[1])]));
  if (info.app !== APP_MARKER) throw new Error(t("notAWallet"));

  return {
    id: info.id,
    name: info.name || "Wallet",
    currency: info.currency || "EUR",
    createdAt: info.createdAt,
    ownerId: info.ownerId.toLowerCase(),
    code: info.code || undefined,
    password: info.passwordHash ? { salt: info.passwordSalt, hash: info.passwordHash } : undefined,
    members: body(SHEETS.members).map((r) => ({
      id: str(r[0]).toLowerCase(),
      name: str(r[1]) || str(r[0]),
      picture: str(r[2]) || undefined,
      joinedAt: cellTimestamp(r[3]),
    })),
    expenses: body(SHEETS.expenses)
      .filter((r) => str(r[0]))
      .map((r) => ({
        id: str(r[0]),
        date: cellDate(r[1]),
        note: str(r[2]),
        amountCents: cellCents(r[3]),
        createdBy: str(r[4]).toLowerCase(),
        splitAmong: idList(r[6]),
        createdAt: cellTimestamp(r[7]),
        updatedAt: cellTimestamp(r[8]),
      })),
    settlements: body(SHEETS.settlements).map((r) => {
      let transfers = [];
      try {
        transfers = JSON.parse(str(r[4]) || "[]");
      } catch {
        // dettaglio illeggibile (modificato a mano): teniamo il mese come pagato senza dettaglio
      }
      return { month: cellMonth(r[0]), settledBy: str(r[1]).toLowerCase(), settledAt: cellTimestamp(r[2]), transfers };
    }),
  };
}

/** Confronta due tabelle cella per cella (per scrivere solo i fogli cambiati). */
export function sameTable(a = [], b = []) {
  const norm = (rows) => JSON.stringify(nonEmpty(rows).map((r) => r.map((c) => str(c))));
  return norm(a) === norm(b);
}

export function columnLetter(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
