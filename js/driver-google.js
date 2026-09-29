// Wallet su Google Sheets. Serve solo il Client ID OAuth (nessuna chiave API).
// Scope: drive.file per i fogli creati dall'app (elenco, condivisione, indice) e
// spreadsheets per leggere/scrivere anche i fogli condivisi da altri tramite il codice.

import { authFetch, authJson, jsonBody } from "./http.js";
import { SHEETS, SHEET_LIST, sameTable } from "./sheet-model.js";
import { HttpError } from "./util.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
export const FILE_PREFIX = "Family Wallet - ";

const idOf = (key) => key.slice(2);
const quote = (title) => `'${title.replace(/'/g, "''")}'`;

async function readTables(key) {
  const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", majorDimension: "ROWS" });
  for (const s of SHEET_LIST) params.append("ranges", `${quote(s.title)}!A1:Z`);
  const data = await authJson(`${SHEETS_API}/${idOf(key)}/values:batchGet?${params}`);
  return Object.fromEntries(SHEET_LIST.map((s, i) => [s.title, data.valueRanges[i]?.values ?? []]));
}

async function writeTables(key, tables, previous = {}) {
  const changed = SHEET_LIST.map((s) => s.title).filter((t) => !sameTable(tables[t], previous[t]));
  if (changed.length === 0) return;
  await authFetch(
    `${SHEETS_API}/${idOf(key)}/values:batchUpdate`,
    jsonBody("POST", {
      valueInputOption: "RAW",
      data: changed.map((t) => ({ range: `${quote(t)}!A1`, values: tables[t] })),
    }),
  );
  // righe in eccesso (es. spesa cancellata): si svuotano dopo aver scritto, così il foglio non è mai vuoto
  const tails = changed
    .filter((t) => (previous[t]?.length ?? 0) > tables[t].length)
    .map((t) => `${quote(t)}!A${tables[t].length + 1}:Z`);
  if (tails.length) await authFetch(`${SHEETS_API}/${idOf(key)}/values:batchClear`, jsonBody("POST", { ranges: tails }));
}

async function create(name, tables) {
  const sheet = await authJson(
    SHEETS_API,
    jsonBody("POST", {
      properties: { title: `${FILE_PREFIX}${name}`, locale: "it_IT", timeZone: "Europe/Rome" },
      sheets: SHEET_LIST.map((s, i) => ({ properties: { sheetId: i, title: s.title, gridProperties: { frozenRowCount: 1 } } })),
    }),
  );
  const key = `g.${sheet.spreadsheetId}`;
  await writeTables(key, tables);

  const amountCol = SHEETS.expenses.header.indexOf("Importo (€)");
  await authFetch(
    `${SHEETS_API}/${sheet.spreadsheetId}:batchUpdate`,
    jsonBody("POST", {
      requests: [
        ...SHEET_LIST.map((_, i) => ({
          repeatCell: {
            range: { sheetId: i, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        })),
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 1, startColumnIndex: amountCol, endColumnIndex: amountCol + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 9 } } },
      ],
    }),
  );
  // marcatore per ritrovare i wallet con files.list
  await authFetch(
    `${DRIVE_API}/${sheet.spreadsheetId}`,
    jsonBody("PATCH", { appProperties: { familyWallet: "1", walletName: name.slice(0, 60) } }),
  );
  return key;
}

// ---------- indice dei wallet altrui ----------
// Con drive.file l'app vede solo i file che crea: i wallet in cui si entra con il codice
// si ricordano in un piccolo file JSON creato dall'app nel Drive dell'utente.

const INDEX_NAME = "Family Wallet - wallet condivisi.json";
const INDEX_QUERY = "appProperties has { key='familyWalletIndex' and value='1' } and trashed = false";

async function findIndex() {
  const params = new URLSearchParams({ q: INDEX_QUERY, fields: "files(id)", pageSize: "1" });
  const data = await authJson(`${DRIVE_API}?${params}`);
  return data.files[0]?.id ?? null;
}

async function readIndex() {
  const id = await findIndex();
  if (!id) return { id: null, entries: [] };
  const entries = await authJson(`${DRIVE_API}/${id}?alt=media`);
  return { id, entries: Array.isArray(entries) ? entries : [] };
}

async function writeIndex(id, entries) {
  if (id) {
    await authFetch(`${UPLOAD_API}/${id}?uploadType=media`, jsonBody("PATCH", entries));
    return;
  }
  const boundary = `fw${Date.now()}`;
  const metadata = { name: INDEX_NAME, mimeType: "application/json", appProperties: { familyWalletIndex: "1" } };
  await authFetch(`${UPLOAD_API}?uploadType=multipart`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body:
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(entries)}\r\n--${boundary}--`,
  });
}

async function remember(key, name, ownerName) {
  const { id, entries } = await readIndex();
  const others = entries.filter((e) => e.key !== key);
  await writeIndex(id, [...others, { key, name, ownerName }]);
}

async function list() {
  const params = new URLSearchParams({
    q: "appProperties has { key='familyWallet' and value='1' } and trashed = false",
    fields: "files(id,name,ownedByMe,owners(displayName),appProperties)",
    pageSize: "200",
    orderBy: "createdTime",
  });
  const [data, index] = await Promise.all([authJson(`${DRIVE_API}?${params}`), readIndex()]);
  const wallets = data.files.map((f) => ({
    key: `g.${f.id}`,
    name: f.appProperties?.walletName || f.name.replace(FILE_PREFIX, ""),
    ownerName: f.owners?.[0]?.displayName,
    owned: f.ownedByMe,
  }));
  for (const e of index.entries) if (!wallets.some((w) => w.key === e.key)) wallets.push({ ...e, owned: false });
  return wallets;
}

/**
 * Rende il foglio modificabile da chi ne conosce l'id (non compare nelle ricerche)
 * e restituisce il codice del wallet: "G-" + id del file.
 */
async function share(key) {
  await authFetch(
    `${DRIVE_API}/${idOf(key)}/permissions?sendNotificationEmail=false`,
    jsonBody("POST", { role: "writer", type: "anyone", allowFileDiscovery: false }),
  );
  return `G-${idOf(key)}`;
}

/**
 * Dal codice del wallet alla chiave. Il foglio è condiviso "chiunque abbia il link"
 * e l'app ha lo scope spreadsheets, quindi basta verificare di poterlo leggere.
 */
async function resolveCode(code) {
  const fileId = code.slice(2);
  if (!/^[\w-]{10,}$/.test(fileId)) throw new Error("Codice wallet non valido");
  try {
    await authFetch(`${SHEETS_API}/${fileId}?fields=spreadsheetId`);
  } catch (err) {
    if (err instanceof HttpError && [403, 404].includes(err.status)) {
      throw new Error("Wallet non trovato: controlla il codice o chiedi a chi l'ha creato di condividerlo di nuovo");
    }
    throw err;
  }
  return `g.${fileId}`;
}

export const googleDriver = {
  provider: "google",
  storageName: "Google Sheets",
  list,
  create,
  readTables,
  writeTables,
  share,
  resolveCode,
  remember,
  openUrl: async (key) => `https://docs.google.com/spreadsheets/d/${idOf(key)}/edit`,
};
