import type { AppDatabase } from "../db/database.server";
import type { LedgerEntry } from "../domain/ledger";

export function loadEntries(db: AppDatabase, householdId: string, where = "e.voided_at is null", params: unknown[] = []): LedgerEntry[] {
  const rows = db.prepare(`select e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description, e.category_id, e.source_plan_id, e.source_transaction_id, e.voided_at, s.member_key, s.amount_minor as share_minor from ledger_entries e join ledger_shares s on s.entry_id = e.id left join settlement_items si on si.ledger_entry_id = e.id where e.household_id = ? and ${where} order by e.entry_date, e.id`).all(householdId, ...params) as Array<{ id: string; kind: "expense" | "income"; amount_minor: number; cash_member_key: "adam" | "chelsea"; entry_date: string; description: string; category_id: string | null; source_plan_id: string | null; source_transaction_id: string | null; voided_at: string | null; member_key: "adam" | "chelsea"; share_minor: number }>;
  const entries = new Map<string, LedgerEntry>();
  for (const row of rows) {
    const entry = entries.get(row.id) ?? { id: row.id, kind: row.kind, amountMinor: row.amount_minor, cashMemberId: row.cash_member_key, shares: [] as unknown as LedgerEntry["shares"], date: row.entry_date, description: row.description, categoryId: row.category_id ?? undefined, source: row.source_plan_id && row.source_transaction_id ? { planId: row.source_plan_id, transactionId: row.source_transaction_id, accountId: "", sourceAmountMilliunits: 0 } : undefined, voidedAt: row.voided_at ?? undefined };
    entry.shares.push({ memberId: row.member_key, amountMinor: row.share_minor });
    entries.set(row.id, entry);
  }
  return [...entries.values()].filter((entry) => entry.shares.length === 2) as LedgerEntry[];
}
