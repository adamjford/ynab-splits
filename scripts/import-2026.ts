import { readFileSync } from "node:fs";
import { createDatabase } from "../app/db/database.server";
import { parseLegacy2026 } from "../app/importer/legacy2026";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const transactionsPath = argument("--transactions");
const splitViewPath = argument("--split-view");
const householdId = argument("--household");
const apply = process.argv.includes("--apply");
if (!transactionsPath || !splitViewPath || !householdId) throw new Error("usage: pnpm import:2026 -- --transactions <file> --split-view <file> --household <id> [--apply]");

const report = parseLegacy2026(readFileSync(transactionsPath, "utf8"), readFileSync(splitViewPath, "utf8"));
console.log(JSON.stringify({ rows: report.rows.length, transfers: report.transfers.length, periods: report.periods.map((period) => ({ entryCount: period.entryKeys.length, calculatedNetMinor: period.calculatedNetMinor, recordedNetMinor: period.transfer?.recordedNetMinor ?? null, transferAmountMinor: period.transfer?.amountMinor ?? null })) }, null, 2));
if (report.errors.length > 0) {
  console.error(JSON.stringify({ errors: report.errors }, null, 2));
  throw new Error("import validation failed; no rows were written");
}
if (!apply) {
  console.log("Dry run only; database unchanged.");
  process.exit(0);
}

const db = createDatabase(process.env.DATABASE_PATH ?? "./data/ynab-splits.sqlite");
try {
  const members = db.prepare(`select m.member_key, u.display_name from memberships m join users u on u.id = m.user_id where m.household_id = ?`).all(householdId) as Array<{ member_key: "adam" | "chelsea"; display_name: string }>;
  if (members.length !== 2 || !members.some((member) => member.display_name === "Adam") || !members.some((member) => member.display_name === "Chelsea")) throw new Error("household must have exactly named members Adam and Chelsea");
  const transaction = db.transaction(() => {
    const insertEntry = db.prepare(`insert or ignore into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, legacy_key) values (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertShare = db.prepare("insert or ignore into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
    for (const row of report.rows) {
      const id = `legacy:${row.legacyKey}`;
      insertEntry.run(id, householdId, row.kind, row.amountMinor, row.cashMemberKey, row.date, row.description, row.legacyKey);
      insertShare.run(id, "adam", row.shares.adam);
      insertShare.run(id, "chelsea", row.shares.chelsea);
    }
    const insertSettlement = db.prepare(`insert or ignore into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at) values (?, ?, ?, ?, ?, ?, ?, 'closed', CURRENT_TIMESTAMP)`);
    const insertItem = db.prepare("insert or ignore into settlement_items (settlement_id, ledger_entry_id) values (?, ?)");
    for (const period of report.periods) {
      if (!period.transfer) continue;
      const settlementId = `legacy-settlement:${period.transfer.sourceRow}`;
      insertSettlement.run(settlementId, householdId, period.entryKeys.length > 0 ? report.rows.find((row) => row.legacyKey === period.entryKeys[0])?.date ?? period.transfer.date : period.transfer.date, period.transfer.date, period.transfer.debtorMemberKey, period.transfer.creditorMemberKey, period.transfer.amountMinor);
      for (const key of period.entryKeys) insertItem.run(settlementId, `legacy:${key}`);
    }
  });
  transaction();
  console.log(`Applied ${report.rows.length} historical rows and ${report.transfers.length} historical settlements (re-runs are no-ops).`);
} finally {
  db.close();
}
