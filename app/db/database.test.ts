import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.server";

describe("SQLite persistence", () => {
  it("creates the schema with WAL and foreign keys", () => {
    const db = createDatabase(":memory:");
    expect(db.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.prepare("select name from sqlite_master where type = 'table' and name = 'ledger_entries'").get()).toBeTruthy();
    db.close();
  });

  it("rejects duplicate source decisions for one user and transaction", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run("u1", "ynab-u1", "Adam");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run("h1", "u1", "adam");
    const insert = db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision) values (?, ?, ?, ?, ?)");
    insert.run("d1", "u1", "p1", "t1", "shared");
    expect(() => insert.run("d2", "u1", "p1", "t1", "not_shared")).toThrow(/unique/i);
    db.close();
  });

  it("keeps only one action-needed manual task per decision", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run("u1", "ynab-u1", "Adam");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run("h1", "u1", "adam");
    db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision) values (?, ?, ?, ?, ?)").run("d1", "u1", "p1", "t1", "shared");
    const insert = db.prepare("insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values (?, ?, 'action_needed', '{}')");
    insert.run("m1", "d1");
    expect(() => insert.run("m2", "d1")).toThrow(/unique/i);
    db.close();
  });
});
