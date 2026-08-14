import { debtFor, type LedgerEntry, type MemberId } from "./ledger";
import { buildSettlementPreview } from "./settlement";

export interface SettlementSubtransaction {
  amountMinor: number;
  categoryId: string;
  memo: string;
}

export interface SettlementTarget {
  parentAmountMinor: number;
  payee: string;
  categoryId: string | null;
  subtransactions: SettlementSubtransaction[];
}

export function buildSettlementTarget(memberId: MemberId, entries: LedgerEntry[], mode: "simple" | "detailed", splittingCategoryId: string): SettlementTarget {
  const preview = buildSettlementPreview(memberId, entries);
  const counterparty = memberId === "adam" ? "Chelsea" : "Adam";
  if (mode === "simple") return { parentAmountMinor: preview.netMinor, payee: counterparty, categoryId: splittingCategoryId, subtransactions: [] };
  const subtransactions: SettlementSubtransaction[] = [];
  let aggregateSplitting = 0;
  for (const entry of entries) {
    const debt = debtFor(entry, memberId);
    if (debt > 0) subtransactions.push({ amountMinor: -debt, categoryId: entry.categoryId ?? splittingCategoryId, memo: `YS:${entry.id}` });
    if (debt < 0) aggregateSplitting += -debt;
  }
  if (aggregateSplitting !== 0) subtransactions.push({ amountMinor: aggregateSplitting, categoryId: splittingCategoryId, memo: "YS:aggregate" });
  if (subtransactions.reduce((sum, line) => sum + line.amountMinor, 0) !== preview.netMinor) throw new Error("settlement subtransactions must sum to parent");
  return { parentAmountMinor: preview.netMinor, payee: counterparty, categoryId: null, subtransactions };
}
