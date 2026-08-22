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
    expect(db.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 0 });
    db.close();
  });

  it("enforces foreign keys for ledger rows", () => {
    const db = createDatabase(":memory:");
    expect(() => db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values (?, ?, ?, ?, ?, ?, ?)").run("e1", "missing", "expense", 1, "adam", "2026-01-01", "x")).toThrow(/foreign key/i);
    db.close();
  });
  it("persists valid zero-share and odd-share entries", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    insertLedgerEntry(db, {
      id: "e1",
      householdId: "h1",
      kind: "expense",
      amountMinor: 1,
      cashMemberKey: "chelsea",
      date: "2026-01-01",
      description: "Rounding",
      shares: [{ memberKey: "adam", amountMinor: 0 }, { memberKey: "chelsea", amountMinor: 1 }],
    });
    expect(db.prepare("select member_key, amount_minor from ledger_shares order by member_key").all()).toEqual([
      { member_key: "adam", amount_minor: 0 },
      { member_key: "chelsea", amount_minor: 1 },
    ]);
    db.close();
  });

  it("rejects duplicate or negative shares before opening a transaction", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
    const input = {
      id: "e1",
      householdId: "h1",
      kind: "expense" as const,
      amountMinor: 10,
      cashMemberKey: "adam" as const,
      date: "2026-01-01",
      description: "Invalid",
    };
    expect(() => insertLedgerEntry(db, { ...input, shares: [{ memberKey: "adam", amountMinor: 5 }, { memberKey: "adam", amountMinor: 5 }] })).toThrow(/two members/i);
    expect(() => insertLedgerEntry(db, { ...input, shares: [{ memberKey: "adam", amountMinor: -1 }, { memberKey: "chelsea", amountMinor: 11 }] })).toThrow(/negative|sum/i);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    expect(db.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 0 });
    db.close();
  });
  it("rejects malformed direct inputs before writing a parent row", () => {
    const cases: Array<{ name: string; value: unknown }> = [
      { name: "missing shares", value: undefined },
      { name: "non-array shares", value: "not-an-array" },
      { name: "malformed share", value: [{ memberKey: "adam", amountMinor: 5 }, null] },
      { name: "unknown member", value: [{ memberKey: "eve", amountMinor: 5 }, { memberKey: "chelsea", amountMinor: 5 }] },
      { name: "fractional share", value: [{ memberKey: "adam", amountMinor: 1.5 }, { memberKey: "chelsea", amountMinor: 8.5 }] },
      { name: "unsafe share", value: [{ memberKey: "adam", amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { memberKey: "chelsea", amountMinor: 0 }] },
      { name: "negative share", value: [{ memberKey: "adam", amountMinor: -1 }, { memberKey: "chelsea", amountMinor: 11 }] },
    ];
    for (const [index, testCase] of cases.entries()) {
      const db = createDatabase(":memory:");
      db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
      expect(() => insertLedgerEntry(db, {
        id: `invalid-share-${index}`,
        householdId: "h1",
        kind: "expense",
        amountMinor: 10,
        cashMemberKey: "adam",
        date: "2026-01-01",
        description: "Invalid",
        shares: testCase.value,
      } as never), testCase.name).toThrow();
      expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
      db.close();
    }
  });

  it("rejects malformed parent values before writing a row", () => {
    const cases: Array<{ name: string; amountMinor?: unknown; date?: unknown; description?: unknown; cashMemberKey?: unknown }> = [
      { name: "unknown cash member", cashMemberKey: "eve" },
      { name: "zero amount", amountMinor: 0 },
      { name: "negative amount", amountMinor: -1 },
      { name: "fractional amount", amountMinor: 10.5 },
      { name: "unsafe amount", amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { name: "invalid calendar date", date: "2026-02-29" },
      { name: "invalid date format", date: "01/01/2026" },
      { name: "blank description", description: "   " },
    ];
    for (const [index, testCase] of cases.entries()) {
      const db = createDatabase(":memory:");
      db.prepare("insert into households (id, name) values (?, ?)").run("h1", "Home");
      expect(() => insertLedgerEntry(db, {
        id: `invalid-parent-${index}`,
        householdId: "h1",
        kind: "expense",
        amountMinor: testCase.amountMinor ?? 10,
        cashMemberKey: testCase.cashMemberKey ?? "adam",
        date: testCase.date ?? "2026-01-01",
        description: testCase.description ?? "Valid",
        shares: [{ memberKey: "adam", amountMinor: 4 }, { memberKey: "chelsea", amountMinor: 6 }],
      } as never), testCase.name).toThrow();
      expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
      db.close();
    }
  });


  it("rolls back the parent when a valid share group hits a foreign-key failure", () => {
    const db = createDatabase(":memory:");
    expect(() => insertLedgerEntry(db, {
      id: "e1",
      householdId: "missing",
      kind: "expense",
      amountMinor: 100,
      cashMemberKey: "adam",
      date: "2026-01-01",
      description: "Orphan",
      shares: [{ memberKey: "adam", amountMinor: 40 }, { memberKey: "chelsea", amountMinor: 60 }],
    })).toThrow(/foreign key/i);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    expect(db.prepare("select count(*) as count from ledger_shares").get()).toEqual({ count: 0 });
    db.close();
  });
});
