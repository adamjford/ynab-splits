import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { CURRENT_SCHEMA_VERSION, createDatabase } from "../app/db/database.server";
import { applyLegacy2026, preflightLegacy2026 } from "../app/importer/legacy2026-apply.server";
import { parseLegacy2026 } from "../app/importer/legacy2026";

function openReadOnlyDatabase(filename: string): Database.Database {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select max(version) as version from schema_migrations").get() as { version: number | null };
    if (row.version !== CURRENT_SCHEMA_VERSION) throw new Error(`SQLite schema version ${row.version ?? 0} is not current`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

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
const parsed = {
  rows: report.rows.length,
  transfers: report.transfers.length,
  periods: report.periods.length,
  trailingOpenPeriods: report.periods.filter((period) => period.transfer === undefined).length,
};
if (report.errors.length > 0) {
  console.error(JSON.stringify({ mode: apply ? "apply" : "dry-run", parsed, validationErrors: report.errors, writes: "none" }, null, 2));
  process.exitCode = 1;
} else {
  if (!apply && !process.env.DATABASE_PATH) throw new Error("dry-run requires DATABASE_PATH");
  const databasePath = process.env.DATABASE_PATH ?? "./data/ynab-splits.sqlite";
  const db = apply ? createDatabase(databasePath) : openReadOnlyDatabase(databasePath);
  try {
    if (!apply) {
      const preflight = preflightLegacy2026(db, householdId, report);
      console.log(JSON.stringify({
        mode: "dry-run",
        parsed,
        validationErrors: [],
        preflight: { insert: preflight.insert, exactSkip: preflight.skip, immutableConflict: preflight.conflict },
        preflightConflicts: preflight.conflicts,
        applyOutcome: null,
        writes: "none",
      }, null, 2));
      if (preflight.conflicts.length > 0) process.exitCode = 1;
    } else {
      const result = applyLegacy2026(db, householdId, report);
      console.log(JSON.stringify({
        mode: "apply",
        parsed,
        validationErrors: [],
        preflight: { insert: result.preflight.insert, exactSkip: result.preflight.skip, immutableConflict: result.preflight.conflict },
        applyOutcome: { inserted: result.applied, exactSkip: result.skipped, immutableConflict: result.conflicts, blocked: result.blocked },
      }, null, 2));
      if (result.blocked) process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}
