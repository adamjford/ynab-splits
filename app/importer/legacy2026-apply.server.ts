import { withLedgerTransaction, type AppDatabase } from "../db/database.server";
import { assertLedgerEntry } from "../domain/ledger";
import type { LegacyImportReport, LegacyImportRow, LegacyPeriod, LegacyTransfer } from "./legacy2026";

export interface LegacyUnitCounts {
  entries: number;
  shares: number;
  settlements: number;
  items: number;
}

export interface LegacyPreflight {
  insert: LegacyUnitCounts;
  skip: LegacyUnitCounts;
  conflict: LegacyUnitCounts;
  conflicts: string[];
}

export interface LegacyApplyResult {
  householdId: string;
  blocked: boolean;
  preflight: LegacyPreflight;
  applied: LegacyUnitCounts;
  skipped: LegacyUnitCounts;
  conflicts: string[];
}

type MemberKey = "adam" | "chelsea";
type ExistingEntry = {
  id: string;
  household_id: string;
  kind: "expense" | "income";
  amount_minor: number;
  cash_member_key: MemberKey;
  entry_date: string;
  description: string;
  legacy_key: string | null;
};
type ExistingSettlement = {
  id: string;
  household_id: string;
  start_date: string;
  end_date: string;
  debtor_member_key: MemberKey | null;
  creditor_member_key: MemberKey | null;
  amount_minor: number;
  status: "open" | "voided" | "closed";
  acknowledged_payment_at: string | null;
};
type ExistingShare = { member_key: MemberKey; amount_minor: number };
type ExistingItem = { settlement_id: string; ledger_entry_id: string };


function zeroCounts(): LegacyUnitCounts {
  return { entries: 0, shares: 0, settlements: 0, items: 0 };
}

function expectedEntryId(row: LegacyImportRow): string {
  return `legacy:${row.legacyKey}`;
}

function hasUnlinkedAtColumn(db: AppDatabase): boolean {
  const columns = db.prepare("pragma table_info(settlement_items)").all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "unlinked_at");
}

function activeSettlementItems(db: AppDatabase, condition: "settlement_id" | "ledger_entry_id", value: string): ExistingItem[] {
  const unlinkedClause = hasUnlinkedAtColumn(db) ? " and unlinked_at is null" : "";
  return db.prepare(`select settlement_id, ledger_entry_id from settlement_items where ${condition} = ?${unlinkedClause} order by ledger_entry_id`).all(value) as ExistingItem[];
}

function expectedSettlementId(transfer: LegacyTransfer): string {
  return `legacy-settlement:${transfer.sourceRow}`;
}

function expectedRowMap(report: LegacyImportReport): Map<string, LegacyImportRow> {
  const rows = new Map<string, LegacyImportRow>();
  for (const row of report.rows) rows.set(row.legacyKey, row);
  return rows;
}
function validateImportRow(row: LegacyImportRow): string | null {
  try {
    if (row.kind !== "expense" && row.kind !== "income") throw new Error("ledger entry requires a known kind");
    if (row.cashMemberKey !== "adam" && row.cashMemberKey !== "chelsea") throw new Error("ledger entry requires a known cash member");
    const shares = row.shares;
    assertLedgerEntry({
      id: row.legacyKey,
      kind: row.kind,
      amountMinor: row.amountMinor,
      cashMemberId: row.cashMemberKey,
      shares: [
        { memberId: "adam", amountMinor: shares?.adam },
        { memberId: "chelsea", amountMinor: shares?.chelsea },
      ],
      date: row.date,
      description: row.description,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid ledger row";
  }
}


type TransferPeriod = Omit<LegacyPeriod, "transfer"> & { transfer: LegacyTransfer };

function transferPeriods(report: LegacyImportReport): TransferPeriod[] {
  const periods: TransferPeriod[] = [];
  for (const period of report.periods) {
    if (period.transfer === undefined) continue;
    periods.push({ entryKeys: period.entryKeys, calculatedNetMinor: period.calculatedNetMinor, transfer: period.transfer });
  }
  return periods;
}

function sameEntry(existing: ExistingEntry, row: LegacyImportRow, householdId: string): boolean {
  return existing.id === expectedEntryId(row)
    && existing.household_id === householdId
    && existing.kind === row.kind
    && existing.amount_minor === row.amountMinor
    && existing.cash_member_key === row.cashMemberKey
    && existing.entry_date === row.date
    && existing.description === row.description
    && existing.legacy_key === row.legacyKey;
}

function sameSettlement(existing: ExistingSettlement, transfer: LegacyTransfer, householdId: string, startDate: string): boolean {
  return existing.id === expectedSettlementId(transfer)
    && existing.household_id === householdId
    && existing.start_date === startDate
    && existing.end_date === transfer.date
    && existing.debtor_member_key === transfer.debtorMemberKey
    && existing.creditor_member_key === transfer.creditorMemberKey
    && existing.amount_minor === transfer.amountMinor
    && existing.status === "closed"
    && existing.acknowledged_payment_at !== null;
}

function sharesMatch(db: AppDatabase, entryId: string, row: LegacyImportRow): boolean {
  const shares = db.prepare("select member_key, amount_minor from ledger_shares where entry_id = ? order by member_key").all(entryId) as ExistingShare[];
  return shares.length === 2
    && shares[0].member_key === "adam"
    && shares[0].amount_minor === row.shares.adam
    && shares[1].member_key === "chelsea"
    && shares[1].amount_minor === row.shares.chelsea;
}

function itemSetMatches(db: AppDatabase, settlementId: string, expectedIds: string[]): boolean {
  const actual = activeSettlementItems(db, "settlement_id", settlementId);
  const expected = [...expectedIds].sort();
  return actual.length === expected.length && actual.every((item, index) => item.settlement_id === settlementId && item.ledger_entry_id === expected[index]);
}

function addConflict(preflight: LegacyPreflight, message: string, unit: keyof LegacyUnitCounts, count = 1): void {
  preflight.conflicts.push(message);
  preflight.conflict[unit] += count;
}

/**
 * Read and classify every deterministic import unit. This is intentionally
 * separate from writes so callers can show a dry-run without opening a write
 * transaction. A conflict is immutable: it cannot be reconciled by OR IGNORE.
 */
export function preflightLegacy2026(db: AppDatabase, householdId: string, report: LegacyImportReport): LegacyPreflight {
  const preflight: LegacyPreflight = { insert: zeroCounts(), skip: zeroCounts(), conflict: zeroCounts(), conflicts: [] };
  const invalidRows = new Map<LegacyImportRow, string>();
  for (const row of report.rows) {
    const validationError = validateImportRow(row);
    if (validationError !== null) {
      invalidRows.set(row, validationError);
      addConflict(preflight, `row ${row.sourceRow}: ${validationError}`, "entries");
    }
  }
  if (report.errors.length > 0) {
    for (const error of report.errors) preflight.conflicts.push(error);
  }
  const rowsByKey = expectedRowMap(report);
  if (rowsByKey.size !== report.rows.length) addConflict(preflight, "duplicate legacy entry key", "entries");
  const periodTransfers = transferPeriods(report);
  const transferRows = new Set<number>();
  for (const period of periodTransfers) {
    if (transferRows.has(period.transfer.sourceRow)) addConflict(preflight, `duplicate transfer source row ${period.transfer.sourceRow}`, "settlements");
    transferRows.add(period.transfer.sourceRow);
  }

  const members = db.prepare(`select m.member_key from memberships m join users u on u.id = m.user_id where m.household_id = ? order by m.member_key`).all(householdId) as Array<{ member_key: string }>;
  const memberKeys = new Set(members.map((member) => member.member_key));
  const validMembers = members.length === 2
    && memberKeys.size === 2
    && memberKeys.has("adam")
    && memberKeys.has("chelsea");
  if (!validMembers) addConflict(preflight, "household must have exactly member keys adam and chelsea", "entries");

  for (const row of report.rows) {
    if (invalidRows.has(row)) continue;
    const id = expectedEntryId(row);
    const existing = db.prepare("select id, household_id, kind, amount_minor, cash_member_key, entry_date, description, legacy_key from ledger_entries where id = ?").get(id) as ExistingEntry | undefined;
    if (!existing) {
      const alias = db.prepare("select id from ledger_entries where legacy_key = ? and id <> ?").get(row.legacyKey, id) as { id: string } | undefined;
      if (alias) {
        addConflict(preflight, `legacy key ${row.legacyKey} is already used by ${alias.id}`, "entries");
      } else {
        preflight.insert.entries += 1;
        preflight.insert.shares += 2;
      }
      continue;
    }
    if (!sameEntry(existing, row, householdId)) {
      addConflict(preflight, `entry ${id} differs from immutable legacy data`, "entries");
      continue;
    }
    if (!sharesMatch(db, id, row)) {
      addConflict(preflight, `shares for entry ${id} differ from immutable legacy data`, "shares");
      continue;
    }
    preflight.skip.entries += 1;
    preflight.skip.shares += 2;
  }

  for (const period of periodTransfers) {
    const transfer = period.transfer;
    const settlementId = expectedSettlementId(transfer);
    const expectedEntryIds = period.entryKeys.map((key) => `legacy:${key}`);
    const existing = db.prepare("select id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at from settlements where id = ?").get(settlementId) as ExistingSettlement | undefined;
    const startDate = rowsByKey.get(period.entryKeys[0] ?? "")?.date ?? transfer.date;
    if (!existing) {
      preflight.insert.settlements += 1;
      preflight.insert.items += expectedEntryIds.length;
    } else if (!sameSettlement(existing, transfer, householdId, startDate)) {
      addConflict(preflight, `settlement ${settlementId} differs from immutable legacy data`, "settlements");
    } else if (!itemSetMatches(db, settlementId, expectedEntryIds)) {
      addConflict(preflight, `items for settlement ${settlementId} differ from immutable legacy data`, "items");
    } else {
      preflight.skip.settlements += 1;
      preflight.skip.items += expectedEntryIds.length;
    }
    for (const entryId of expectedEntryIds) {
      const linked = activeSettlementItems(db, "ledger_entry_id", entryId);
      if (linked.some((item) => item.settlement_id !== settlementId)) addConflict(preflight, `entry ${entryId} is already linked to another settlement`, "items");
    }
  }
  return preflight;
}

function applyInTransaction(db: AppDatabase, householdId: string, report: LegacyImportReport): LegacyUnitCounts {
  const applied = zeroCounts();
  const insertEntry = db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, legacy_key) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
  const insertSettlement = db.prepare("insert into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at) values (?, ?, ?, ?, ?, ?, ?, 'closed', CURRENT_TIMESTAMP)");
  const insertItem = db.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values (?, ?)");
  const rowsByKey = expectedRowMap(report);
  for (const row of report.rows) {
    const id = expectedEntryId(row);
    if (db.prepare("select 1 from ledger_entries where id = ?").get(id)) continue;
    insertEntry.run(id, householdId, row.kind, row.amountMinor, row.cashMemberKey, row.date, row.description, row.legacyKey);
    insertShare.run(id, "adam", row.shares.adam);
    insertShare.run(id, "chelsea", row.shares.chelsea);
    applied.entries += 1;
    applied.shares += 2;
  }
  for (const period of transferPeriods(report)) {
    const transfer = period.transfer;
    const settlementId = expectedSettlementId(transfer);
    if (db.prepare("select 1 from settlements where id = ?").get(settlementId)) continue;
    const startDate = rowsByKey.get(period.entryKeys[0] ?? "")?.date ?? transfer.date;
    insertSettlement.run(settlementId, householdId, startDate, transfer.date, transfer.debtorMemberKey, transfer.creditorMemberKey, transfer.amountMinor);
    applied.settlements += 1;
    for (const key of period.entryKeys) {
      insertItem.run(settlementId, `legacy:${key}`);
      applied.items += 1;
    }
  }
  return applied;
}

/** Apply a validated report atomically, or make no writes when any conflict exists. */
export function applyLegacy2026(db: AppDatabase, householdId: string, report: LegacyImportReport): LegacyApplyResult {
  return withLedgerTransaction(db, () => {
    const preflight = preflightLegacy2026(db, householdId, report);
    if (preflight.conflicts.length > 0) {
      return { householdId, blocked: true, preflight, applied: zeroCounts(), skipped: zeroCounts(), conflicts: preflight.conflicts };
    }
    const applied = applyInTransaction(db, householdId, report);
    return { householdId, blocked: false, preflight, applied, skipped: preflight.skip, conflicts: [] };
  });
}
