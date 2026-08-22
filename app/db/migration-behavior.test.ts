import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  getSchemaVersion,
  validateLedgerInvariants,
  withLedgerTransaction,
  type AppDatabase,
} from "./database.server";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
function makeLegacyFile(withSnapshot: boolean): string {
  const directory = mkdtempSync(join(tmpdir(), "ynab-legacy-"));
  paths.push(directory);
  const filename = join(directory, withSnapshot ? "v2.sqlite" : "v1.sqlite");
  const current = createDatabase(filename);
  current.close();

  const raw = new Database(filename);
  raw.pragma("foreign_keys = OFF");
  raw.exec(`
    DROP TRIGGER ledger_share_identity_immutable;
    DROP TRIGGER ledger_share_update_total_check;
    DROP TRIGGER ledger_parent_amount_check;
    DROP TRIGGER ledger_share_delete_check;
    DROP INDEX one_active_settlement_item;
    ALTER TABLE category_assignments RENAME TO category_assignments_current;
    CREATE TABLE category_assignments (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      PRIMARY KEY (user_id, category_id)
    );
    DROP TABLE category_assignments_current;
    ALTER TABLE settlement_items RENAME TO settlement_items_current;
    CREATE TABLE settlement_items (
      settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
      ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(id),
      PRIMARY KEY (settlement_id, ledger_entry_id)
    );
    DROP TABLE settlement_items_current;
  `);
  if (!withSnapshot) {
    raw.exec(`
      ALTER TABLE ynab_transaction_decisions RENAME TO ynab_transaction_decisions_current;
      CREATE TABLE ynab_transaction_decisions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        ynab_transaction_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('shared', 'not_shared', 'dismissed')),
        ledger_entry_id TEXT REFERENCES ledger_entries(id),
        source_snapshot_hash TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, plan_id, ynab_transaction_id)
      );
      DROP TABLE ynab_transaction_decisions_current;
    `);
  }
  raw.exec("DROP TABLE runtime_metadata");
  raw.exec("DROP TABLE schema_migrations");
  raw.close();
  return filename;
}

function seedLegacyRows(filename: string): void {
  const db = new Database(filename);
  db.exec(`
    INSERT INTO users (id, ynab_user_id, display_name) VALUES ('u1', 'y1', 'Adam');
    INSERT INTO households (id, name) VALUES ('h1', 'Home');
    INSERT INTO memberships (household_id, user_id, member_key) VALUES ('h1', 'u1', 'adam');
    INSERT INTO category_assignments (user_id, category_id, category_name) VALUES ('u1', 'source-1', 'Groceries');
    INSERT INTO ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description)
      VALUES ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'Legacy');
    INSERT INTO ledger_shares (entry_id, member_key, amount_minor) VALUES ('e1', 'adam', 40), ('e1', 'chelsea', 60);
    INSERT INTO settlements (id, household_id, start_date, end_date, amount_minor, status, acknowledged_payment_at)
      VALUES ('s1', 'h1', '2026-01-01', '2026-01-02', 100, 'open', '2026-01-03');
    INSERT INTO settlement_items (settlement_id, ledger_entry_id) VALUES ('s1', 'e1');
  `);
  db.close();
}
function seedIncompleteLegacyRows(filename: string): void {
  const db = new Database(filename);
  db.exec(`
    INSERT INTO households (id, name) VALUES ('h1', 'Home');
    INSERT INTO ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description)
      VALUES ('broken', 'h1', 'expense', 100, 'adam', '2026-01-01', 'Broken');
    INSERT INTO ledger_shares (entry_id, member_key, amount_minor) VALUES ('broken', 'adam', 100);
  `);
  db.close();
}

function seedEntry(db: AppDatabase, id = "e1"): void {
  db.prepare("insert into households (id, name) values ('h1', 'Home')").run();
  db.prepare(
    "insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values (?, 'h1', 'expense', 100, 'adam', '2026-01-01', 'x')",
  ).run(id);
}

describe("ordered SQLite migrations and ledger invariants", () => {
  it("applies every migration in order and reopens idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-version-"));
    paths.push(directory);
    const filename = join(directory, "schema.sqlite");
    const db = createDatabase(filename);
    expect(getSchemaVersion(db)).toBe(4);
    expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);
    db.close();
    const reopened = createDatabase(filename);
    expect(getSchemaVersion(reopened)).toBe(4);
    expect(reopened.prepare("select count(*) as count from schema_migrations").get()).toEqual({ count: 4 });
    reopened.close();
  });
  it("initializes and enforces an instance owner marker without touching product tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-owner-"));
    paths.push(directory);
    const filename = join(directory, "owned.sqlite");
    const ownerless = createDatabase(filename);
    expect(ownerless.prepare("select count(*) as count from runtime_metadata").get()).toEqual({ count: 0 });
    ownerless.close();

    const owned = createDatabase(filename, "instance-a");
    expect(owned.prepare("select key, value from runtime_metadata").all()).toEqual([
      { key: "database_owner", value: "instance-a" },
    ]);
    expect(
      owned.prepare("select name from sqlite_master where type = 'table' and name = 'runtime_metadata'").get(),
    ).toBeTruthy();
    expect(owned.prepare("select name from sqlite_master where type = 'table' and name = 'users'").get()).toBeTruthy();
    owned.close();

    const reopened = createDatabase(filename, "instance-a");
    reopened.close();
    expect(() => createDatabase(filename, "instance-b")).toThrow(/owner/i);
  });

  it("rejects malformed owner markers and malformed owner IDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-owner-malformed-"));
    paths.push(directory);
    const filename = join(directory, "malformed.sqlite");
    const db = createDatabase(filename);
    db.close();
    const raw = new Database(filename);
    raw.prepare("insert into runtime_metadata (key, value) values (?, ?)").run("database_owner", "bad owner");
    raw.close();
    expect(() => createDatabase(filename, "instance-a")).toThrow(/malformed/i);

    const unmarked = join(directory, "invalid-owner.sqlite");
    expect(() => createDatabase(unmarked, "bad owner")).toThrow(/malformed/i);
  });

  it("enforces complete two-member ledger groups and allows zero shares", () => {
    const db = createDatabase(":memory:");
    seedEntry(db);
    expect(() =>
      withLedgerTransaction(db, () => {
        db.prepare(
          "insert into ledger_shares (entry_id, member_key, amount_minor) values ('e1', 'adam', 50), ('e1', 'chelsea', 50)",
        ).run();
      }),
    ).not.toThrow();
    expect(() =>
      db.prepare("update ledger_shares set amount_minor = 49 where entry_id = 'e1' and member_key = 'adam'").run(),
    ).toThrow(/sum/i);
    expect(() => db.prepare("delete from ledger_shares where entry_id = 'e1' and member_key = 'adam'").run()).toThrow(
      /cannot be deleted/i,
    );
    const db2 = createDatabase(":memory:");
    seedEntry(db2, "e2");
    db2
      .prepare(
        "insert into ledger_shares (entry_id, member_key, amount_minor) values ('e2', 'adam', 0), ('e2', 'chelsea', 100)",
      )
      .run();
    expect(() => validateLedgerInvariants(db2)).not.toThrow();
    db.close();
    db2.close();
  });

  it("has corrected household and category uniqueness boundaries", () => {
    const db = createDatabase(":memory:");
    db.exec(
      "insert into users (id, ynab_user_id, display_name) values ('u1', 'y1', 'Adam'), ('u2', 'y2', 'Chelsea'), ('u3', 'y3', 'Other'); insert into households (id, name) values ('h1', 'One'), ('h2', 'Two'); insert into memberships (household_id, user_id, member_key) values ('h1', 'u1', 'adam'), ('h2', 'u2', 'adam');",
    );
    expect(() =>
      db.prepare("insert into memberships (household_id, user_id, member_key) values ('h1', 'u3', 'adam')").run(),
    ).toThrow(/unique/i);
    expect(() =>
      db.prepare("insert into memberships (household_id, user_id, member_key) values ('h2', 'u1', 'chelsea')").run(),
    ).toThrow(/unique/i);
    const columns = db.prepare("pragma table_info(category_assignments)").all() as Array<{ name: string }>;
    expect(columns.map((row) => row.name)).toEqual([
      "user_id",
      "source_category_id",
      "source_category_name",
      "destination_category_id",
      "destination_category_name",
    ]);
    const indexes = db.prepare("pragma index_list(category_assignments)").all() as Array<{ origin: string }>;
    expect(indexes.some((row) => row.origin === "pk")).toBe(true);
  });

  it("upgrades recognized v1 and v2 legacy schemas and preserves rows", () => {
    for (const withSnapshot of [false, true]) {
      const filename = makeLegacyFile(withSnapshot);
      seedLegacyRows(filename);
      const db = createDatabase(filename);
      expect(getSchemaVersion(db)).toBe(4);
      expect(db.prepare("select source_category_id, destination_category_id from category_assignments").all()).toEqual([
        { source_category_id: "source-1", destination_category_id: "source-1" },
      ]);
      expect(db.prepare("select status from settlements where id = 's1'").get()).toEqual({ status: "closed" });
      expect(db.prepare("select unlinked_at from settlement_items where settlement_id = 's1'").get()).toEqual({
        unlinked_at: null,
      });
      expect(db.prepare("pragma table_info(ynab_transaction_decisions)").all()).toHaveLength(9);
      db.close();
    }
  });
  it("rolls back a failed legacy migration and closes the connection", () => {
    const filename = makeLegacyFile(true);
    seedIncompleteLegacyRows(filename);
    expect(() => createDatabase(filename)).toThrow(/corruption|exactly one/i);
    const reopened = new Database(filename);
    expect(reopened.open).toBe(true);
    expect(reopened.prepare("select version from schema_migrations order by version").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    expect(
      reopened.prepare("select name from sqlite_master where type = 'table' and name like '%_legacy'").all(),
    ).toEqual([]);
    expect(
      reopened
        .prepare("select name from sqlite_master where type = 'index' and name = 'one_active_settlement_item'")
        .all(),
    ).toEqual([]);
    reopened.close();
  });

  it("rejects unknown migration history and closes failed files", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-migration-"));
    paths.push(directory);
    const filename = join(directory, "unknown.sqlite");
    const raw = new Database(filename);
    raw.exec("create table mystery (id text)");
    raw.close();
    expect(() => createDatabase(filename)).toThrow(/baseline|schema/i);
    const badIndexFile = makeLegacyFile(true);
    const badIndexDb = new Database(badIndexFile);
    badIndexDb.exec("create index unfamiliar_index on users(display_name)");
    badIndexDb.close();
    expect(() => createDatabase(badIndexFile)).toThrow(/indexes|baseline/i);
    const badTriggerFile = makeLegacyFile(true);
    const badTriggerDb = new Database(badTriggerFile);
    badTriggerDb.exec("create trigger unfamiliar_trigger after insert on users begin select 1; end");
    badTriggerDb.close();
    expect(() => createDatabase(badTriggerFile)).toThrow(/triggers|baseline/i);

    const incomplete = join(directory, "incomplete.sqlite");
    const incompleteDb = new Database(incomplete);
    incompleteDb.exec(
      "create table schema_migrations (version integer primary key, applied_at text not null); create table users (id text)",
    );
    incompleteDb.close();
    expect(() => createDatabase(incomplete)).toThrow(/incomplete|history/i);

    const gapped = join(directory, "gapped.sqlite");
    const gappedDb = new Database(gapped);
    gappedDb.exec(
      "create table schema_migrations (version integer primary key, applied_at text not null); insert into schema_migrations values (1, 'now'), (3, 'now')",
    );
    gappedDb.close();
    expect(() => createDatabase(gapped)).toThrow(/gapped|history/i);

    const future = join(directory, "future.sqlite");
    const futureDb = new Database(future);
    futureDb.exec(
      "create table schema_migrations (version integer primary key, applied_at text not null); insert into schema_migrations values (99, 'now')",
    );
    futureDb.close();
    expect(() => createDatabase(future)).toThrow(/newer|migration/i);
    const canReopen = new Database(future);
    expect(canReopen.open).toBe(true);
    canReopen.close();
  });

  it("diagnoses persisted corruption when opening an existing database", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-corrupt-"));
    paths.push(directory);
    const filename = join(directory, "ledger.sqlite");
    const db = createDatabase(filename);
    seedEntry(db);
    db.prepare(
      "insert into ledger_shares (entry_id, member_key, amount_minor) values ('e1', 'adam', 50), ('e1', 'chelsea', 50)",
    ).run();
    db.exec(
      "drop trigger ledger_share_update_total_check; update ledger_shares set amount_minor = 49 where entry_id = 'e1' and member_key = 'adam'",
    );
    db.close();
    expect(() => createDatabase(filename)).toThrow(/ledger corruption|sum/i);
    const reopened = new Database(filename);
    expect(reopened.open).toBe(true);
    reopened.close();
  });

  it("reports an empty migration history as version zero", () => {
    const db = new Database(":memory:");
    db.exec("create table schema_migrations (version integer primary key, applied_at text not null)");
    expect(getSchemaVersion(db)).toBe(0);
    db.close();
  });
  it("diagnoses a parent with no share rows", () => {
    const db = createDatabase(":memory:");
    seedEntry(db, "missing-shares");
    expect(() => validateLedgerInvariants(db)).toThrow(/missing-shares|corruption/i);
    db.close();
  });
});
