// Wallet su un file Excel in OneDrive (cartella App/Family Wallet del creatore),
// letto e scritto con l'API Excel di Microsoft Graph.

import { authFetch, authJson, jsonBody } from "./http.js";
import { SHEET_LIST, columnLetter, sameTable } from "./sheet-model.js";
import { HttpError, b64urlText, fromB64urlText } from "./util.js";
import { buildXlsx } from "./xlsx.js";
import { t } from "./i18n.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const APPROOT = `${GRAPH}/me/drive/special/approot`;
const JOINED_FILE = "wallet-condivisi.json";
export const FILE_PREFIX = "Family Wallet - ";

// chiave: m~{driveId}~{itemId}
const makeKey = (item) => `m~${item.parentReference.driveId}~${item.id}`;
function itemUrl(key) {
  const [, driveId, itemId] = key.split("~");
  return `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
}
const sheetUrl = (key, title) => `${itemUrl(key)}/workbook/worksheets/${encodeURIComponent(title)}`;
const nameFromFile = (fileName) => fileName.replace(FILE_PREFIX, "").replace(/\.xlsx$/i, "");

async function readTables(key) {
  const entries = await Promise.all(
    SHEET_LIST.map(async (s) => {
      const range = await authJson(`${sheetUrl(key, s.title)}/usedRange(valuesOnly=true)?$select=values`);
      return [s.title, range.values ?? []];
    }),
  );
  return Object.fromEntries(entries);
}

async function writeTables(key, tables, previous = {}) {
  for (const s of SHEET_LIST) {
    const rows = tables[s.title];
    const old = previous[s.title] ?? [];
    if (sameTable(rows, old)) continue;

    const width = Math.max(...rows.map((r) => r.length), ...old.map((r) => r.length), 1);
    const values = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
    const lastCol = columnLetter(width - 1);
    await authFetch(
      `${sheetUrl(key, s.title)}/range(address='A1:${lastCol}${rows.length}')`,
      jsonBody("PATCH", { values }),
    );
    if (old.length > rows.length) {
      await authFetch(
        `${sheetUrl(key, s.title)}/range(address='A${rows.length + 1}:${lastCol}${old.length}')/clear`,
        jsonBody("POST", { applyTo: "Contents" }),
      );
    }
  }
}

async function create(name, tables) {
  const blob = buildXlsx(SHEET_LIST.map((s) => ({ title: s.title, textColumns: s.textColumns, rows: tables[s.title] })));
  const fileName = `${FILE_PREFIX}${name.replace(/[\\/:*?"<>|#%]/g, " ").trim()}.xlsx`;
  const item = await authJson(
    `${APPROOT}:/${encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=rename`,
    { method: "PUT", headers: { "Content-Type": blob.type }, body: blob },
  );
  return makeKey(item);
}

async function readJoined() {
  try {
    return await authJson(`${APPROOT}:/${JOINED_FILE}:/content`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

async function list() {
  const [own, joined] = await Promise.all([
    authJson(`${APPROOT}/children?$select=id,name,parentReference,file&$top=200`),
    readJoined(),
  ]);
  const wallets = own.value
    .filter((f) => f.file && f.name.startsWith(FILE_PREFIX) && f.name.endsWith(".xlsx"))
    .map((f) => ({ key: makeKey(f), name: nameFromFile(f.name), owned: true }));
  for (const j of joined) if (!wallets.some((w) => w.key === j.key)) wallets.push({ ...j, owned: false });
  return wallets;
}

/**
 * Crea un link di modifica "chiunque abbia il link" (o interno all'organizzazione, se l'account
 * aziendale non consente link anonimi) e restituisce il codice del wallet: "M-" + link codificato.
 */
async function share(key) {
  let link;
  try {
    link = await authJson(`${itemUrl(key)}/createLink`, jsonBody("POST", { type: "edit", scope: "anonymous" }));
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    link = await authJson(`${itemUrl(key)}/createLink`, jsonBody("POST", { type: "edit", scope: "organization" }));
  }
  return `M-${b64urlText(link.link.webUrl)}`;
}

/** Dal codice del wallet alla chiave, riscattando il link di condivisione. */
async function resolveCode(code) {
  let url;
  try {
    url = fromB64urlText(code.slice(2));
  } catch {
    throw new Error(t("invalidCode"));
  }
  if (!/^https:\/\//.test(url)) throw new Error(t("invalidCode"));
  try {
    const item = await authJson(`${GRAPH}/shares/u!${b64urlText(url)}/driveItem?$select=id,name,parentReference`, {
      headers: { Prefer: "redeemSharingLink" },
    });
    return makeKey(item);
  } catch (err) {
    if (err instanceof HttpError && [400, 403, 404].includes(err.status)) {
      throw new Error(t("walletNotFound"));
    }
    throw err;
  }
}

/** Salva nella propria cartella dell'app l'elenco dei wallet altrui a cui si è entrati. */
async function remember(key, name, ownerName) {
  const joined = await readJoined();
  if (joined.some((j) => j.key === key)) return;
  joined.push({ key, name, ownerName });
  await authFetch(`${APPROOT}:/${JOINED_FILE}:/content`, jsonBody("PUT", joined));
}

async function openUrl(key) {
  return (await authJson(`${itemUrl(key)}?$select=webUrl`)).webUrl;
}

export const microsoftDriver = {
  provider: "microsoft",
  storageName: "Excel su OneDrive",
  list,
  create,
  readTables,
  writeTables,
  share,
  resolveCode,
  remember,
  openUrl,
};
