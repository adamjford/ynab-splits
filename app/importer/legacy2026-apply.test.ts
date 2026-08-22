import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "../db/database.server";
import { applyLegacy2026, preflightLegacy2026 } from "./legacy2026-apply.server";
import type { LegacyImportReport, LegacyImportRow } from "./legacy2026";

const open: LegacyImportReport = {
  errors: [],
  rows: [{ legacyKey: "sheet-2026:2", sourceRow: 2, kind: "expense", amountMinor: 1889, date: "2026-01-01", description: "Amazon", cashMemberKey: "adam", shares: { adam: 945, chelsea: 944 } }],
  transfers: [],
  periods: [{ entryKeys: ["sheet-2026:2"], calculatedNetMinor: -944 }],
};
const closed: LegacyImportReport = {
  ...open,
  transfers: [{ sourceRow: 3, date: "2026-01-02", amountMinor: 944, debtorMemberKey: "adam", creditorMemberKey: "chelsea", recordedNetMinor: -944 }],
  periods: [{ entryKeys: ["sheet-2026:2"], calculatedNetMinor: -944, transfer: { sourceRow: 3, date: "2026-01-02", amountMinor: 944, debtorMemberKey: "adam", creditorMemberKey: "chelsea", recordedNetMinor: -944 } }],
};

function setup(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), "ynab-import-"));
  paths.push(directory);
  const db = createDatabase(join(directory, "ledger.sqlite"));
  db.exec("insert into users (id, ynab_user_id, display_name) values ('u1', 'y1', 'Adam'), ('u2', 'y2', 'Chelsea'); insert into households (id, name) values ('h1', 'Home'); insert into memberships (household_id, user_id, member_key) values ('h1', 'u1', 'adam'), ('h1', 'u2', 'chelsea');");
  return db;
}

const databases: AppDatabase[] = [];
const paths: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("legacy 2026 atomic apply", () => {

  it("preflights and applies deterministic entries and shares with truthful deltas", () => {
    const db = setup(); databases.push(db);
    expect(preflightLegacy2026(db, "h1", open)).toMatchObject({ insert: { entries: 1, shares: 2 }, skip: { entries: 0 } });
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    const first = applyLegacy2026(db, "h1", open);
    expect(first).toMatchObject({ blocked: false, applied: { entries: 1, shares: 2 }, skipped: { entries: 0 } });
    const second = applyLegacy2026(db, "h1", open);
    expect(second).toMatchObject({ blocked: false, applied: { entries: 0, shares: 0 }, skipped: { entries: 1, shares: 2 } });
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
  });

  it("applies a closed period and blocks immutable conflicts atomically", () => {
    const db = setup(); databases.push(db);
    const dryRun = preflightLegacy2026(db, "h1", closed);
    expect(dryRun).toMatchObject({ insert: { entries: 1, shares: 2, settlements: 1, items: 1 }, skip: { entries: 0, shares: 0, settlements: 0, items: 0 }, conflict: { entries: 0, shares: 0, settlements: 0, items: 0 } });
    const result = applyLegacy2026(db, "h1", closed);
    expect(result).toMatchObject({ blocked: false, applied: { entries: 1, shares: 2, settlements: 1, items: 1 } });
    expect(db.prepare("select status, amount_minor from settlements where id = 'legacy-settlement:3'").get()).toEqual({ status: "closed", amount_minor: 944 });
    const replay = applyLegacy2026(db, "h1", closed);
    expect(replay).toMatchObject({ blocked: false, applied: { entries: 0, shares: 0, settlements: 0, items: 0 }, skipped: { entries: 1, shares: 2, settlements: 1, items: 1 } });

    const conflict: LegacyImportReport = { ...open, rows: [{ ...open.rows[0], description: "Changed" }] };
    const blocked = applyLegacy2026(db, "h1", conflict);
    expect(blocked.blocked).toBe(true);
    expect(blocked.applied).toEqual({ entries: 0, shares: 0, settlements: 0, items: 0 });
    expect(db.prepare("select description from ledger_entries where id = 'legacy:sheet-2026:2'").get()).toEqual({ description: "Amazon" });
  });

  it("rejects parser errors and household membership mismatches without writes", () => {
    const db = setup(); databases.push(db);
    expect(applyLegacy2026(db, "h1", { ...open, errors: ["bad source row"] }).blocked).toBe(true);
    db.prepare("delete from memberships where household_id = 'h1' and member_key = 'chelsea'").run();
    const result = applyLegacy2026(db, "h1", open);
    expect(result.blocked).toBe(true);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
  });
  it("permits custom display names when household member keys are valid", () => {
    const db = setup(); databases.push(db);
    db.exec("update users set display_name = case id when 'u1' then 'A.' when 'u2' then 'C.' end");
    const result = applyLegacy2026(db, "h1", open);
    expect(result.blocked).toBe(false);
    expect(result.applied).toMatchObject({ entries: 1, shares: 2 });
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
  });
  it("rejects invalid programmatic rows before classification and leaves the database unchanged", () => {
    const db = setup(); databases.push(db);
    const invalidRows: LegacyImportRow[] = [
      { ...open.rows[0], date: "2026-02-30" },
      { ...open.rows[0], description: "   " },
      { ...open.rows[0], amountMinor: 0, shares: { adam: 0, chelsea: 0 } },
      { ...open.rows[0], amountMinor: Number.MAX_SAFE_INTEGER + 1, shares: { adam: 1, chelsea: 1 } },
      { ...open.rows[0], shares: { adam: -1, chelsea: 1890 } },
      { ...open.rows[0], shares: { adam: 944, chelsea: 944 } },
    ];
    for (const row of invalidRows) {
      const report: LegacyImportReport = { ...open, rows: [row] };
      const dryRun = preflightLegacy2026(db, "h1", report);
      expect(dryRun.conflicts.length).toBeGreaterThan(0);
      expect(dryRun.insert).toEqual({ entries: 0, shares: 0, settlements: 0, items: 0 });
      const result = applyLegacy2026(db, "h1", report);
      expect(result.blocked).toBe(true);
      expect(result.applied).toEqual({ entries: 0, shares: 0, settlements: 0, items: 0 });
      expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
      expect(db.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 0 });
    }
  });


  it("blocks missing related shares or settlement items without applying", () => {
    const sharesDb = setup(); databases.push(sharesDb);
    applyLegacy2026(sharesDb, "h1", open);
    sharesDb.exec("drop trigger ledger_share_delete_check");
    sharesDb.prepare("delete from ledger_shares where entry_id = 'legacy:sheet-2026:2' and member_key = 'chelsea'").run();
    const sharesResult = preflightLegacy2026(sharesDb, "h1", open);
    expect(sharesResult.conflict.shares).toBe(1);
    expect(sharesResult.conflicts.join(" ")).toMatch(/shares.*differ/i);
    expect(sharesDb.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 1 });

    const itemsDb = setup(); databases.push(itemsDb);
    applyLegacy2026(itemsDb, "h1", closed);
    itemsDb.prepare("delete from settlement_items where settlement_id = 'legacy-settlement:3'").run();
    const itemsResult = preflightLegacy2026(itemsDb, "h1", closed);
    expect(itemsResult.conflict.items).toBe(1);
    expect(itemsResult.conflicts.join(" ")).toMatch(/items.*differ/i);
    expect(itemsDb.prepare("select count(*) as count from settlement_items").get()).toEqual({ count: 0 });
  });

  it("does not partially apply new rows when an immutable conflict is present", () => {
    const db = setup(); databases.push(db);
    applyLegacy2026(db, "h1", open);
    const expanded: LegacyImportReport = {
      ...open,
      rows: [...open.rows, {
        legacyKey: "sheet-2026:4",
        sourceRow: 4,
        kind: "income",
        amountMinor: 500,
        date: "2026-01-04",
        description: "Refund",
        cashMemberKey: "chelsea",
        shares: { adam: 125, chelsea: 375 },
      }],
      periods: [{ entryKeys: ["sheet-2026:2", "sheet-2026:4"], calculatedNetMinor: -569 }],
    };
    const conflict: LegacyImportReport = { ...expanded, rows: [{ ...expanded.rows[0], description: "Changed" }, expanded.rows[1]] };
    const result = applyLegacy2026(db, "h1", conflict);
    expect(result.blocked).toBe(true);
    expect(result.preflight.insert.entries).toBe(1);
    expect(result.applied).toEqual({ entries: 0, shares: 0, settlements: 0, items: 0 });
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
    expect(db.prepare("select count(*) as count from ledger_entries where id = 'legacy:sheet-2026:4'").get()).toEqual({ count: 0 });
  });

  it("classifies duplicate keys, aliases, settlement mismatches, and competing links", () => {
    const duplicateDb = setup(); databases.push(duplicateDb);
    const duplicate = { ...open, rows: [...open.rows, { ...open.rows[0], sourceRow: 9 }] };
    expect(preflightLegacy2026(duplicateDb, "h1", duplicate).conflicts.join(" ")).toMatch(/duplicate legacy entry/i);
    duplicateDb.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, legacy_key) values ('other', 'h1', 'expense', 1889, 'adam', '2026-01-01', 'Amazon', 'sheet-2026:2')").run();
    expect(preflightLegacy2026(duplicateDb, "h1", open).conflicts.join(" ")).toMatch(/already used/i);

    const settlementDb = setup(); databases.push(settlementDb);
    applyLegacy2026(settlementDb, "h1", closed);
    settlementDb.prepare("update settlements set amount_minor = 1 where id = 'legacy-settlement:3'").run();
    expect(preflightLegacy2026(settlementDb, "h1", closed).conflicts.join(" ")).toMatch(/settlement .*differs/i);
    settlementDb.prepare("update settlements set amount_minor = 944").run();
    settlementDb.prepare("insert into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at) values ('other-settlement', 'h1', '2026-01-01', '2026-01-02', 'adam', 'chelsea', 944, 'closed', CURRENT_TIMESTAMP)").run();
    settlementDb.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, legacy_key) values ('legacy:sheet-2026:4', 'h1', 'income', 500, 'chelsea', '2026-01-04', 'Refund', 'sheet-2026:4')").run();
    settlementDb.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values ('other-settlement', 'legacy:sheet-2026:4')").run();
    const linkedReport = { ...closed, periods: [{ ...closed.periods[0], entryKeys: ["sheet-2026:2", "sheet-2026:4"] }] };
    expect(preflightLegacy2026(settlementDb, "h1", linkedReport).conflicts.join(" ")).toMatch(/already linked/i);
  });
  it("rejects duplicate transfer source rows and uses transfer dates for orphan periods", () => {
    const db = setup(); databases.push(db);
    const transfer = closed.transfers[0];
    const report: LegacyImportReport = {
      rows: [], errors: [], transfers: [transfer],
      periods: [
        { entryKeys: ["missing"], calculatedNetMinor: 0, transfer },
        { entryKeys: ["other"], calculatedNetMinor: 0, transfer },
      ],
    };
    const result = preflightLegacy2026(db, "h1", report);
    expect(result.conflicts.join(" ")).toMatch(/duplicate transfer source row/i);
    expect(result.insert.settlements).toBe(2);
  });
  it("supports settlement item tables without the later unlink column", () => {
    const db = setup(); databases.push(db);
    db.exec(`
      DROP INDEX one_active_settlement_item;
      DROP TABLE settlement_items;
      CREATE TABLE settlement_items (
        settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
        ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(id),
        PRIMARY KEY (settlement_id, ledger_entry_id)
      );
    `);
    const result = applyLegacy2026(db, "h1", closed);
    expect(result).toMatchObject({ blocked: false, applied: { entries: 1, shares: 2, settlements: 1, items: 1 } });
  });

  it("uses the transfer date when a period has no source entry", () => {
    const db = setup(); databases.push(db);
    const report: LegacyImportReport = {
      rows: [],
      errors: [],
      transfers: [closed.transfers[0]],
      periods: [{ entryKeys: [], calculatedNetMinor: 0, transfer: closed.transfers[0] }],
    };
    const result = applyLegacy2026(db, "h1", report);
    expect(result).toMatchObject({ blocked: false, applied: { entries: 0, shares: 0, settlements: 1, items: 0 } });
    expect(db.prepare("select start_date, end_date from settlements where id = 'legacy-settlement:3'").get()).toEqual({
      start_date: "2026-01-02",
      end_date: "2026-01-02",
    });
  });
  it("rolls back all inserted rows when a SQL failure occurs mid-apply", () => {
    const db = setup(); databases.push(db);
    const second = { ...open.rows[0], legacyKey: "sheet-2026:3", sourceRow: 3, description: "Coffee" };
    const report: LegacyImportReport = {
      ...open,
      rows: [open.rows[0], second],
      periods: [{ entryKeys: [open.rows[0].legacyKey, second.legacyKey], calculatedNetMinor: -944 }],
    };
    db.exec("create trigger fail_second_legacy_entry before insert on ledger_entries when new.legacy_key = 'sheet-2026:3' begin select raise(abort, 'forced importer failure'); end");
    expect(() => applyLegacy2026(db, "h1", report)).toThrow(/forced importer failure/);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    expect(db.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 0 });
  });

  it("reports CLI dry-run preflight deltas without writes and skips the database on parse errors", () => {
    const db = setup();
    const databasePath = join(paths.at(-1)!, "ledger.sqlite");
    db.close();
    const directory = paths.at(-1)!;
    const transactionsPath = join(directory, "transactions.csv");
    const splitPath = join(directory, "split.csv");
    writeFileSync(transactionsPath, "Date,Name,Amount (negative if income),Paid/received by\n2026-01-01,Amazon,18.89,Adam\n");
    writeFileSync(splitPath, "ignored\nignored\nDate,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea\nspacer\n2026-01-01,Amazon,18.89,Adam,,,,,,,,9.44,,9.45,9.44\n");
    const run = (path?: string, extra: string[] = [], environment = "development", configuredPath: string | null | undefined = path, flag = "--environment") => {
      const env = { ...process.env };
      if (path) env.DATABASE_PATH = path;
      else delete env.DATABASE_PATH;
      const cwd = mkdtempSync(join(tmpdir(), "ynab-import-cli-"));
      paths.push(cwd);
      if (configuredPath) {
        const filename = environment === "production" || environment === "prod" ? ".env.production" : ".env.development";
        writeFileSync(join(cwd, filename), `DATABASE_PATH=${configuredPath}\n`);
      }
      return spawnSync(
        process.execPath,
        [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "scripts/import-2026.ts"), flag, environment, "--transactions", transactionsPath, "--split-view", splitPath, "--household", "h1", ...extra],
        { encoding: "utf8", cwd, env },
      );
    };
    const first = run(databasePath, [], "dev", databasePath, "--env");
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).preflight).toMatchObject({
      insert: { entries: 1, shares: 2, settlements: 0, items: 0 },
      exactSkip: { entries: 0, shares: 0, settlements: 0, items: 0 },
      immutableConflict: { entries: 0, shares: 0, settlements: 0, items: 0 },
    });
    expect(JSON.parse(first.stdout)).toMatchObject({ environment: "development" });
    const selectedConfigPath = join(directory, "selected-config.sqlite");
    const selectedConfig = run(databasePath, [], "dev", selectedConfigPath, "--env");
    expect(selectedConfig.status).not.toBe(0);
    expect(selectedConfig.stderr).toMatch(/database|file/i);
    expect(existsSync(selectedConfigPath)).toBe(false);
    const afterFirst = createDatabase(databasePath);
    expect(afterFirst.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    afterFirst.close();

    const applied = run(databasePath, ["--apply"]);
    expect(applied.status).toBe(0);
    const second = run(databasePath);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).preflight.exactSkip).toMatchObject({ entries: 1, shares: 2 });
    const afterSecond = createDatabase(databasePath);
    expect(afterSecond.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
    afterSecond.close();
    const productionEnvironment = run(databasePath, [], "prod");
    expect(productionEnvironment.status).toBe(0);
    expect(JSON.parse(productionEnvironment.stdout)).toMatchObject({ environment: "production" });
    const productionAlias = run(databasePath, [], "production", databasePath, "--env");
    expect(productionAlias.status).toBe(0);
    expect(JSON.parse(productionAlias.stdout)).toMatchObject({ environment: "production" });
    const productionExternal = run(databasePath, [], "production", null);
    expect(productionExternal.status).toBe(0);
    const absentPath = join(directory, "absent.sqlite");
    const absent = run(absentPath);
    expect(absent.status).not.toBe(0);
    expect(absent.stderr).toMatch(/database|file/i);
    expect(existsSync(absentPath)).toBe(false);

    const invalidEnvironment = run(databasePath, [], "staging");
    expect(invalidEnvironment.status).not.toBe(0);
    expect(invalidEnvironment.stderr).toMatch(/dev\|development\|prod\|production/);

    const missingPath = run(undefined, ["--apply"], "production");
    expect(missingPath.status).not.toBe(0);
    expect(missingPath.stderr).toMatch(/DATABASE_PATH.*production/i);

    const parseErrorPath = join(directory, "parse-error.sqlite");
    writeFileSync(transactionsPath, "Date,Name\n\"unterminated");
    const parseError = run(parseErrorPath);
    expect(parseError.status).not.toBe(0);
    expect(parseError.stderr).toMatch(/validationErrors/);
    expect(existsSync(parseErrorPath)).toBe(false);
  });

});
