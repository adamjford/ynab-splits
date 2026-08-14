import type { AppDatabase } from "./database.server";

export interface LedgerInsert {
  id: string;
  householdId: string;
  kind: "expense" | "income";
  amountMinor: number;
  cashMemberKey: "adam" | "chelsea";
  date: string;
  description: string;
  categoryId?: string;
  shares: [{ memberKey: "adam" | "chelsea"; amountMinor: number }, { memberKey: "adam" | "chelsea"; amountMinor: number }];
}

export function insertLedgerEntry(db: AppDatabase, input: LedgerInsert): void {
  if (input.shares[0].memberKey === input.shares[1].memberKey) throw new Error("ledger shares require two members");
  if (input.shares[0].amountMinor < 0 || input.shares[1].amountMinor < 0 || input.shares[0].amountMinor + input.shares[1].amountMinor !== input.amountMinor) {
    throw new Error("ledger shares must sum to entry amount");
  }
  const transaction = db.transaction(() => {
    db.prepare(`insert into ledger_entries
      (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id)
      values (@id, @householdId, @kind, @amountMinor, @cashMemberKey, @date, @description, @categoryId)`)
      .run({ ...input, categoryId: input.categoryId ?? null });
    const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
    for (const share of input.shares) insertShare.run(input.id, share.memberKey, share.amountMinor);
  });
  transaction();
}
