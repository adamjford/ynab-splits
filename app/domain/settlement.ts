import { debtFor, type LedgerEntry, type MemberId } from "./ledger";

export interface SettlementSideItem {
  entryId: string;
  amountMinor: number;
}

export interface SettlementPreview {
  netMinor: number;
  direction: "owed" | "owes" | "settled";
  owes: SettlementSideItem[];
  owed: SettlementSideItem[];
}

export function buildSettlementPreview(memberId: MemberId, openEntries: LedgerEntry[]): SettlementPreview {
  const owes: SettlementSideItem[] = [];
  const owed: SettlementSideItem[] = [];
  let netMinor = 0;

  for (const entry of openEntries) {
    if (entry.voidedAt) continue;
    const debt = debtFor(entry, memberId);
    netMinor -= debt;
    if (debt > 0) owes.push({ entryId: entry.id, amountMinor: debt });
    if (debt < 0) owed.push({ entryId: entry.id, amountMinor: -debt });
  }

  return {
    netMinor,
    direction: netMinor > 0 ? "owed" : netMinor < 0 ? "owes" : "settled",
    owes,
    owed,
  };
}
