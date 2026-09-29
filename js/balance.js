// Calcolo dei saldi mensili: ogni spesa è divisa in parti uguali tra i membri
// indicati in `splitAmong`; chi l'ha inserita è chi l'ha pagata.

export const monthOf = (date) => date.slice(0, 7);

/** Divide un importo; i centesimi di resto vanno ai primi membri (ordinati per id). */
export function splitCents(amountCents, memberIds) {
  const ids = [...new Set(memberIds)].sort();
  const shares = new Map();
  if (ids.length === 0) return shares;
  const base = Math.floor(amountCents / ids.length);
  let remainder = amountCents - base * ids.length;
  for (const id of ids) {
    shares.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return shares;
}

export function computeBalances(expenses, memberIds) {
  const acc = new Map();
  const get = (id) => {
    if (!acc.has(id)) acc.set(id, { memberId: id, paidCents: 0, shareCents: 0, balanceCents: 0 });
    return acc.get(id);
  };
  memberIds.forEach(get);
  for (const e of expenses) {
    const split = e.splitAmong?.length ? e.splitAmong : [e.createdBy];
    get(e.createdBy).paidCents += e.amountCents;
    for (const [id, share] of splitCents(e.amountCents, split)) get(id).shareCents += share;
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
