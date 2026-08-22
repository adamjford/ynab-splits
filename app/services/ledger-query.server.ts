import type { AppDatabase } from "../db/database.server";
import { assertLedgerEntry, type LedgerEntry } from "../domain/ledger";

type LedgerRow = {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  cash_member_key: "adam" | "chelsea";
  entry_date: string;
  description: string;
  category_id: string | null;
  source_plan_id: string | null;
  source_transaction_id: string | null;
  voided_at: string | null;
  correction_of_id: string | null;
  member_key: "adam" | "chelsea" | null;
  share_minor: number | null;
};

function corruptionError(
  id: string,
  message = "must have exactly one Adam and one Chelsea share summing to its amount",
): Error {
  return new Error(`ledger corruption: entry ${id} ${message}`);
}

function assertProjectedEntry(entry: LedgerEntry, message?: string): void {
  try {
    const members = entry.shares.map((share) => share.memberId).sort();
    if (members[0] !== "adam" || members[1] !== "chelsea") throw corruptionError(entry.id, message);
    assertLedgerEntry(entry);
  } catch {
    throw corruptionError(entry.id, message);
  }
}

function buildEntry(rows: LedgerRow[], id: string): LedgerEntry {
  const first = rows[0];
  const shares = rows
    .filter((row) => row.member_key !== null)
    .map((row) => ({ memberId: row.member_key as "adam" | "chelsea", amountMinor: row.share_minor as number }));
  const entry: LedgerEntry = {
    id,
    kind: first.kind,
    amountMinor: first.amount_minor,
    cashMemberId: first.cash_member_key,
    shares: shares as LedgerEntry["shares"],
    date: first.entry_date,
    description: first.description,
    categoryId: first.category_id ?? undefined,
    source:
      first.source_plan_id && first.source_transaction_id
        ? {
            planId: first.source_plan_id,
            transactionId: first.source_transaction_id,
            accountId: "",
            sourceAmountMilliunits: 0,
          }
        : undefined,
    voidedAt: first.voided_at ?? undefined,
    correctionOfId: first.correction_of_id ?? undefined,
  };
  assertProjectedEntry(entry);
  return entry;
}

/** Load complete entries; malformed share groups are never silently filtered out. */
export function loadEntries(
  db: AppDatabase,
  householdId: string,
  where = "e.voided_at is null",
  params: unknown[] = [],
): LedgerEntry[] {
  const settlementJoin = where.includes("si.") ? "JOIN settlement_items si ON si.ledger_entry_id = e.id" : "";
  const rows = db
    .prepare(
      `
    SELECT e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description,
           e.category_id, e.source_plan_id, e.source_transaction_id, e.voided_at,
           e.correction_of_id, s.member_key, s.amount_minor AS share_minor
    FROM ledger_entries e
    ${settlementJoin}
    LEFT JOIN ledger_shares s ON s.entry_id = e.id
    WHERE e.household_id = ? AND ${where}
      ${
        settlementJoin
          ? ""
          : `AND NOT EXISTS (
        SELECT 1 FROM settlement_items active_item
        WHERE active_item.ledger_entry_id = e.id AND active_item.unlinked_at IS NULL
      )`
      }
    ORDER BY e.entry_date, e.id, s.member_key
  `,
    )
    .all(householdId, ...params) as LedgerRow[];
  const grouped = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.id);
    if (group) group.push(row);
    else grouped.set(row.id, [row]);
  }
  return [...grouped].map(([id, entryRows]) => buildEntry(entryRows, id));
}

export interface SharedLedgerEntry {
  id: string;
  kind: LedgerEntry["kind"];
  amountMinor: number;
  payerMemberKey: "adam" | "chelsea";
  date: string;
  description: string;
  shares: { adam: number; chelsea: number };
}

export function toSharedLedgerEntry(entry: LedgerEntry): SharedLedgerEntry {
  assertProjectedEntry(entry, "must contain Adam and Chelsea shares");
  const adam = entry.shares.find((share) => share.memberId === "adam");
  const chelsea = entry.shares.find((share) => share.memberId === "chelsea");
  if (!adam || !chelsea) throw corruptionError(entry.id, "must contain Adam and Chelsea shares");
  return {
    id: entry.id,
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    payerMemberKey: entry.cashMemberId as "adam" | "chelsea",
    date: entry.date,
    description: entry.description,
    shares: { adam: adam.amountMinor, chelsea: chelsea.amountMinor },
  };
}
