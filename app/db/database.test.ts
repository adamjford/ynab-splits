import { describe, expect, it } from "vitest";
import { createDatabase, validateLedgerInvariants } from "./database.server";

describe("SQLite persistence", () => {
  it("creates the schema with WAL and foreign keys", () => {
    const db = createDatabase(":memory:");
    expect(db.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(
      db.prepare("select name from sqlite_master where type = 'table' and name = 'ledger_entries'").get(),
    ).toBeTruthy();
    db.close();
  });

  it("rejects duplicate source decisions for one user and transaction", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run("u1", "ynab-u1", "Adam");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run("h1", "u1", "adam");
    const insert = db.prepare(
      "insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision) values (?, ?, ?, ?, ?)",
    );
    insert.run("d1", "u1", "p1", "t1", "shared");
    expect(() => insert.run("d2", "u1", "p1", "t1", "not_shared")).toThrow(/unique/i);
    db.close();
  });

  it("keeps only one action-needed manual task per decision while retaining history", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run("u1", "ynab-u1", "Adam");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run("h1", "u1", "adam");
    db.prepare(
      "insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision) values (?, ?, ?, ?, ?)",
    ).run("d1", "u1", "p1", "t1", "shared");
    const insert = db.prepare(
      "insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values (?, ?, ?, '{}')",
    );
    insert.run("m1", "d1", "action_needed");
    expect(() => insert.run("m2", "d1", "action_needed")).toThrow(/unique/i);
    db.prepare("update manual_ynab_tasks set status = 'verified' where id = 'm1'").run();
    insert.run("m2", "d1", "action_needed");
    db.prepare("update manual_ynab_tasks set status = 'dismissed' where id = 'm2'").run();
    insert.run("m3", "d1", "action_needed");
    expect(db.prepare("select id, status from manual_ynab_tasks order by id").all()).toEqual([
      { id: "m1", status: "verified" },
      { id: "m2", status: "dismissed" },
      { id: "m3", status: "action_needed" },
    ]);
    expect(() => insert.run("m4", "d1", "unknown")).toThrow(/check/i);
    db.close();
  });

  it("enforces posting statuses, import idempotency, and per-owner settlement uniqueness", () => {
    const db = createDatabase(":memory:");
    db.exec(`
      insert into users (id, ynab_user_id, display_name) values ('u1', 'ynab-u1', 'Adam'), ('u2', 'ynab-u2', 'Chelsea');
      insert into households (id, name) values ('h1', 'Home');
      insert into settlements (id, household_id, start_date, end_date, amount_minor, status)
        values ('s1', 'h1', '2026-01-01', '2026-01-02', 0, 'open');
    `);
    for (const [index, status] of ["open", "voided", "closed"].entries()) {
      db.prepare(
        "insert into settlements (id, household_id, start_date, end_date, amount_minor, status) values (?, 'h1', '2026-01-01', '2026-01-02', 0, ?)",
      ).run(`status-settlement-${index}`, status);
    }
    expect(() =>
      db
        .prepare(
          "insert into settlements (id, household_id, start_date, end_date, amount_minor, status) values ('bad-settlement-status', 'h1', '2026-01-01', '2026-01-02', 0, 'unknown')",
        )
        .run(),
    ).toThrow(/check/i);
    const insert = db.prepare(`
      insert into ynab_postings
        (id, settlement_id, user_id, posting_kind, status, import_id, intended_target_json)
      values (?, ?, ?, 'source', ?, ?, '{}')
    `);
    for (const [index, status] of ["pending", "succeeded", "conflict", "failed", "skipped"].entries()) {
      insert.run(`status-${index}`, null, "u1", status, `status-import-${index}`);
    }
    expect(() => insert.run("bad-status", null, "u1", "unknown", "bad-status-import")).toThrow(/check/i);
    insert.run("settlement-u1", "s1", "u1", "pending", "settlement-u1-import");
    insert.run("settlement-u2", "s1", "u2", "succeeded", "settlement-u2-import");
    expect(() => insert.run("settlement-u1-again", "s1", "u1", "failed", "settlement-u1-again-import")).toThrow(
      /unique/i,
    );
    expect(() => insert.run("duplicate-import", null, "u2", "failed", "settlement-u1-import")).toThrow(/unique/i);
    db.close();
  });

  it("preserves settlement unlink audit history while allowing active reuse", () => {
    const db = createDatabase(":memory:");
    db.exec(`
      insert into households (id, name) values ('h1', 'Home');
      insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description)
        values ('e1', 'h1', 'expense', 10, 'adam', '2026-01-01', 'Entry');
      insert into ledger_shares (entry_id, member_key, amount_minor) values ('e1', 'adam', 4), ('e1', 'chelsea', 6);
      insert into settlements (id, household_id, start_date, end_date, amount_minor, status)
        values ('s1', 'h1', '2026-01-01', '2026-01-02', 10, 'open'),
               ('s2', 'h1', '2026-01-03', '2026-01-04', 10, 'open');
      insert into settlement_items (settlement_id, ledger_entry_id) values ('s1', 'e1');
    `);
    expect(() =>
      db.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values ('s2', 'e1')").run(),
    ).toThrow(/unique/i);
    db.prepare(
      "update settlement_items set unlinked_at = '2026-01-05' where settlement_id = 's1' and ledger_entry_id = 'e1'",
    ).run();
    db.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values ('s2', 'e1')").run();
    expect(
      db
        .prepare("select unlinked_at from settlement_items where settlement_id = 's1' and ledger_entry_id = 'e1'")
        .get(),
    ).toEqual({ unlinked_at: "2026-01-05" });
    db.close();
  });
  it("rejects a direct share group that omits its parent cash member", () => {
    const db = createDatabase(":memory:");
    db.exec(`
      insert into households (id, name) values ('h1', 'Home');
      insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description)
        values ('incomplete', 'h1', 'expense', 10, 'adam', '2026-01-01', 'Incomplete');
      insert into ledger_shares (entry_id, member_key, amount_minor)
        values ('incomplete', 'chelsea', 10);
    `);
    expect(() => validateLedgerInvariants(db)).toThrow(/exactly one Adam and one Chelsea share/i);
    db.close();
  });
});
