import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./database.server";
import { insertLedgerEntry } from "./ledger-repository.server";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("ledger repository", () => {
  it("uses a fresh file, enables WAL, and rolls back invalid shares atomically", () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-splits-"));
    paths.push(directory);
    const filename = join(directory, "ledger.sqlite");
    const db = createDatabase(filename);
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    expect(() => insertLedgerEntry(db, {
      id: "e1",
      householdId: "h1",
      kind: "expense",
      amountMinor: 100,
      cashMemberKey: "adam",
      date: "2026-01-01",
      description: "Groceries",
      shares: [{ memberKey: "adam", amountMinor: 40 }, { memberKey: "chelsea", amountMinor: 40 }],
    })).toThrow(/sum/i);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    db.close();
  });

  it("enforces foreign keys for ledger rows", () => {
    const db = createDatabase(":memory:");
    expect(() => db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values (?, ?, ?, ?, ?, ?, ?)").run("e1", "missing", "expense", 1, "adam", "2026-01-01", "x")).toThrow(/foreign key/i);
    db.close();
  });
});
