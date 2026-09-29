import { test } from "node:test";
import assert from "node:assert/strict";
import { docToTables, tablesToDoc } from "../js/sheet-model.js";

const doc = {
  id: "w1",
  name: "Casa",
  currency: "EUR",
  createdAt: "2026-09-01T10:00:00.000Z",
  ownerId: "fabiano@x.it",
  code: "G-abc123def456",
  password: { salt: "s", hash: "h" },
  members: [
    { id: "fabiano@x.it", name: "Fabiano", picture: undefined, joinedAt: "2026-09-01T10:00:00.000Z", push: [] },
    {
      id: "selene@x.it",
      name: "Selene",
      picture: "https://x/p.png",
      joinedAt: "2026-09-02T10:00:00.000Z",
      push: [{ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BPub", auth: "sec" } }],
    },
  ],
  expenses: [
    {
      id: "e_1",
      date: "2026-09-10",
      note: "Spesa",
      amountCents: 1250,
      paidBy: "selene@x.it",
      createdBy: "fabiano@x.it",
      splitAmong: ["fabiano@x.it", "selene@x.it"],
      createdAt: "2026-09-10T10:00:00.000Z",
      updatedAt: "2026-09-10T10:00:00.000Z",
    },
  ],
  settlements: [
    {
      month: "2026-08",
      settledBy: "fabiano@x.it",
      settledAt: "2026-09-01T10:00:00.000Z",
      transfers: [{ from: "fabiano@x.it", to: "selene@x.it", amountCents: 10000 }],
    },
  ],
};

test("documento -> fogli -> documento non perde dati", () => {
  assert.deepEqual(tablesToDoc(docToTables(doc)), doc);
});

test("il foglio Mesi pagati è leggibile da una persona", () => {
  const row = docToTables(doc)["Mesi pagati"][1];
  assert.match(row[3], /^Fabiano → Selene: 100,00\s€$/);
});

test("date e mesi convertiti da Excel in numeri seriali tornano stringhe", () => {
  const tables = docToTables(doc);
  tables.Spese[1][1] = 46275; // 10/09/2026 come seriale Excel
  tables["Mesi pagati"][1][0] = 46235; // 01/08/2026
  const back = tablesToDoc(tables);
  assert.equal(back.expenses[0].date, "2026-09-10");
  assert.equal(back.settlements[0].month, "2026-08");
});

test("un file che non è un wallet viene rifiutato", () => {
  assert.throws(() => tablesToDoc({ Info: [["Chiave", "Valore"]] }), Error);
});

test("foglio creato prima della colonna \"Inserita da\": vale chi ha pagato", () => {
  const tables = docToTables(doc);
  tables.Spese = tables.Spese.map((row) => row.slice(0, 9));
  const back = tablesToDoc(tables);
  assert.equal(back.expenses[0].paidBy, "selene@x.it");
  assert.equal(back.expenses[0].createdBy, "selene@x.it");
});
