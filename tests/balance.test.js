import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBalances, computeTransfers, monthSummary } from "../js/balance.js";

const exp = (id, createdBy, amountCents, splitAmong, date = "2026-09-10") => ({
  id,
  date,
  note: id,
  amountCents,
  createdBy,
  splitAmong,
  createdAt: "",
  updatedAt: "",
});

test("Fabiano deve 100 € a Selene", () => {
  const ids = ["fabiano", "selene"];
  const balances = computeBalances([exp("1", "selene", 30000, ids), exp("2", "fabiano", 10000, ids)], ids);
  assert.deepEqual(computeTransfers(balances), [{ from: "fabiano", to: "selene", amountCents: 10000 }]);
});

test("tre persone: pagamenti minimi", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(computeTransfers(computeBalances([exp("1", "a", 9000, ids)], ids)), [
    { from: "b", to: "a", amountCents: 3000 },
    { from: "c", to: "a", amountCents: 3000 },
  ]);
});

test("i centesimi di resto non si accumulano sulla stessa persona", () => {
  // due spese da 16,45 € pagate da Fabiano e divise a metà: 32,90 € in tutto, 16,45 € a testa
  const ids = ["fabiano", "selene"];
  const balances = computeBalances([exp("1", "fabiano", 1645, ids), exp("2", "fabiano", 1645, ids)], ids);
  assert.deepEqual(
    balances.map((b) => [b.memberId, b.shareCents]),
    [
      ["fabiano", 1645],
      ["selene", 1645],
    ],
  );
  assert.deepEqual(computeTransfers(balances), [{ from: "selene", to: "fabiano", amountCents: 1645 }]);
});

test("totale non divisibile: i centesimi avanzati sono al massimo uno a testa e la somma torna", () => {
  // 20,00 € tra tre persone = 6,666… a testa: due quote da 6,67 e una da 6,66
  const ids = ["a", "b", "c"];
  const balances = computeBalances([exp("1", "a", 1000, ids), exp("2", "b", 1000, ids)], ids);
  const shares = Object.fromEntries(balances.map((b) => [b.memberId, b.shareCents]));
  assert.equal(shares.a + shares.b + shares.c, 2000);
  // il centesimo in più va a chi ha pagato, non a chi deve dare
  assert.deepEqual(shares, { a: 667, b: 667, c: 666 });
});

test("spesa divisa solo con una persona", () => {
  const balances = computeBalances([exp("1", "a", 5000, ["b"])], ["a", "b"]);
  assert.deepEqual(computeTransfers(balances), [{ from: "b", to: "a", amountCents: 5000 }]);
});

test("monthSummary considera solo il mese richiesto", () => {
  const doc = {
    members: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    expenses: [exp("1", "a", 2000, ["a", "b"], "2026-09-01"), exp("2", "b", 5000, ["a", "b"], "2026-08-31")],
    settlements: [{ month: "2026-08", settledBy: "a", settledAt: "", transfers: [] }],
  };
  const s = monthSummary(doc, "2026-09");
  assert.equal(s.totalCents, 2000);
  assert.equal(s.settlement, undefined);
  assert.deepEqual(s.transfers, [{ from: "b", to: "a", amountCents: 1000 }]);
  assert.ok(monthSummary(doc, "2026-08").settlement);
});
