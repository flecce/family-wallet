// Calcolo dei saldi mensili: ogni spesa è divisa in parti uguali tra i membri
// indicati in `splitAmong` ed è a credito di chi l'ha pagata (`paidBy`).

const payerOf = (e) => e.paidBy || e.createdBy;

export const monthOf = (date) => date.slice(0, 7);

/**
 * Saldi del periodo. Le quote si sommano esatte (anche con frazioni di centesimo) e si
 * arrotondano una volta sola alla fine: arrotondare spesa per spesa accumulerebbe i
 * centesimi di resto sempre sulla stessa persona.
 */
export function computeBalances(expenses, memberIds) {
  const acc = new Map();
  const exact = new Map(); // quota esatta in centesimi, non arrotondata
  const get = (id) => {
    if (!acc.has(id)) {
      acc.set(id, { memberId: id, paidCents: 0, shareCents: 0, balanceCents: 0 });
      exact.set(id, 0);
    }
    return acc.get(id);
  };
  memberIds.forEach(get);

  let totalCents = 0;
  for (const e of expenses) {
    const split = [...new Set(e.splitAmong?.length ? e.splitAmong : [payerOf(e)])];
    get(payerOf(e)).paidCents += e.amountCents;
    totalCents += e.amountCents;
    for (const id of split) {
      get(id);
      exact.set(id, exact.get(id) + e.amountCents / split.length);
    }
  }

  // arrotondamento per difetto, poi i centesimi mancanti a chi ha la parte decimale più alta
  // (a parità, a chi ha pagato di più): la somma delle quote torna sempre uguale al totale
  const EPS = 1e-6;
  for (const [id, value] of exact) acc.get(id).shareCents = Math.floor(value + EPS);
  let missing = totalCents - [...acc.values()].reduce((sum, b) => sum + b.shareCents, 0);
  const byRemainder = [...exact.entries()]
    .map(([id, value]) => ({ id, rest: value - acc.get(id).shareCents }))
    .sort((a, b) => b.rest - a.rest || acc.get(b.id).paidCents - acc.get(a.id).paidCents || a.id.localeCompare(b.id));
  for (const { id } of byRemainder) {
    if (missing <= 0) break;
    acc.get(id).shareCents += 1;
    missing--;
  }

  for (const b of acc.values()) b.balanceCents = b.paidCents - b.shareCents;
  return [...acc.values()];
}

/** Riduce i saldi a pochi pagamenti "X deve N € a Y" (greedy: debitore maggiore -> creditore maggiore). */
export function computeTransfers(balances) {
  const byAmount = (a, b) => b.amount - a.amount || a.id.localeCompare(b.id);
  const debtors = balances.filter((b) => b.balanceCents < 0).map((b) => ({ id: b.memberId, amount: -b.balanceCents })).sort(byAmount);
  const creditors = balances.filter((b) => b.balanceCents > 0).map((b) => ({ id: b.memberId, amount: b.balanceCents })).sort(byAmount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amountCents: amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}

export function monthSummary(doc, month) {
  const expenses = doc.expenses.filter((e) => monthOf(e.date) === month);
  const balances = computeBalances(
    expenses,
    doc.members.map((m) => m.id),
  );
  return {
    month,
    expenses,
    totalCents: expenses.reduce((s, e) => s + e.amountCents, 0),
    balances,
    transfers: computeTransfers(balances),
    settlement: doc.settlements.find((s) => s.month === month),
  };
}
