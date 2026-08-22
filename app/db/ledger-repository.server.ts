import { withLedgerTransaction, type AppDatabase } from "./database.server";

export interface LedgerInsert {
  id: string;
  householdId: string;
  kind: "expense" | "income";
  amountMinor: number;
  cashMemberKey: "adam" | "chelsea";
  date: string;
  description: string;
  categoryId?: string;
  shares: [
    { memberKey: "adam" | "chelsea"; amountMinor: number },
    { memberKey: "adam" | "chelsea"; amountMinor: number },
  ];
}

function assertValidCalendarDate(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("ledger date must be a calendar date");
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth) throw new Error("ledger date must be a calendar date");
}

function assertValidLedgerInput(input: LedgerInsert): void {
  if (input.cashMemberKey !== "adam" && input.cashMemberKey !== "chelsea")
    throw new Error("ledger entry requires a known cash member");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error("ledger amount must be a positive safe integer");
  assertValidCalendarDate(input.date);
  if (typeof input.description !== "string" || input.description.trim() === "")
    throw new Error("ledger description cannot be blank");
  if (!Array.isArray(input.shares) || input.shares.length !== 2)
    throw new Error("ledger shares require exactly two members");
  const members = new Set<string>();
  for (const share of input.shares) {
    if (share === null || typeof share !== "object" || !("memberKey" in share) || !("amountMinor" in share)) {
      throw new Error("ledger shares are malformed");
    }
    const memberKey = share.memberKey;
    const amountMinor = share.amountMinor;
    if (memberKey !== "adam" && memberKey !== "chelsea") throw new Error("ledger shares require known members");
    if (members.has(memberKey)) throw new Error("ledger shares require two members");
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
      throw new Error("ledger shares must be non-negative safe integers");
    members.add(memberKey);
  }
  const [first, second] = input.shares;
  if (!members.has(input.cashMemberKey)) throw new Error("ledger entry cash member must have a share");
  if (BigInt(first.amountMinor) + BigInt(second.amountMinor) !== BigInt(input.amountMinor)) {
    throw new Error("ledger shares must sum to entry amount");
  }
}

export function insertLedgerEntry(db: AppDatabase, input: LedgerInsert): void {
  assertValidLedgerInput(input);
  withLedgerTransaction(db, () => {
    db.prepare(
      `insert into ledger_entries
      (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id)
      values (@id, @householdId, @kind, @amountMinor, @cashMemberKey, @date, @description, @categoryId)`,
    ).run({ ...input, categoryId: input.categoryId ?? null });
    const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
    for (const share of input.shares) insertShare.run(input.id, share.memberKey, share.amountMinor);
  });
}
