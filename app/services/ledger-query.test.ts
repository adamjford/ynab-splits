import { describe, expect, it } from "vitest";
import { createDatabase } from "../db/database.server";
import { loadEntries, toSharedLedgerEntry } from "./ledger-query.server";

function setup() {
  const db = createDatabase(":memory:");
  db.exec(
    "insert into households (id, name) values ('h1', 'Home'), ('h2', 'Other'); insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, source_plan_id, source_transaction_id) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'visible', 'private-plan', 'private-tx'), ('e2', 'h1', 'expense', 100, 'adam', '2026-01-02', 'settled', null, null), ('e3', 'h1', 'expense', 100, 'adam', '2026-01-03', 'voided', null, null), ('e4', 'h2', 'expense', 100, 'adam', '2026-01-01', 'other', null, null); update ledger_entries set voided_at = '2026-01-04' where id = 'e3'; insert into ledger_shares values ('e1', 'adam', 40), ('e1', 'chelsea', 60), ('e2', 'adam', 40), ('e2', 'chelsea', 60), ('e3', 'adam', 40), ('e3', 'chelsea', 60), ('e4', 'adam', 40), ('e4', 'chelsea', 60); insert into settlements (id, household_id, start_date, end_date, amount_minor, status) values ('s1', 'h1', '2026-01-01', '2026-01-02', 20, 'closed'); insert into settlement_items (settlement_id, ledger_entry_id) values ('s1', 'e2');",
  );
  return db;
}

describe("ledger query boundaries", () => {
  it("loads only active household entries and projects safe shared facts", () => {
    const db = setup();
    const entries = loadEntries(db, "h1");
    expect(entries.map((entry) => entry.id)).toEqual(["e1"]);
    expect(toSharedLedgerEntry(entries[0])).toEqual({
      id: "e1",
      kind: "expense",
      amountMinor: 100,
      payerMemberKey: "adam",
      date: "2026-01-01",
      description: "visible",
      shares: { adam: 40, chelsea: 60 },
    });
    db.close();
  });

  it("reports missing, duplicate, or mismatched shares instead of dropping a parent", () => {
    const db = createDatabase(":memory:");
    db.exec(
      "insert into households (id, name) values ('h1', 'Home'); insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('bad', 'h1', 'expense', 100, 'adam', '2026-01-01', 'bad');",
    );
    db.exec("drop trigger ledger_share_total_check");
    expect(() => loadEntries(db, "h1")).toThrow(/corruption.*bad/i);
    db.close();
  });

  it("rejects unsafe shared projection input", () => {
    expect(() =>
      toSharedLedgerEntry({
        id: "bad",
        kind: "expense",
        amountMinor: 1,
        cashMemberId: "adam",
        shares: [{ memberId: "adam", amountMinor: 1 }],
        date: "2026-01-01",
        description: "bad",
      } as unknown as Parameters<typeof toSharedLedgerEntry>[0]),
    ).toThrow(/corruption/i);
  });
  it("filters active settlement links while retaining unlinked history", () => {
    const db = setup();
    db.exec(`
      insert into settlements (id, household_id, start_date, end_date, amount_minor, status)
        values ('s2', 'h1', '2026-01-01', '2026-01-05', 100, 'voided');
      insert into settlement_items (settlement_id, ledger_entry_id, unlinked_at)
        values ('s2', 'e1', '2026-01-06');
    `);
    expect(loadEntries(db, "h1").map((entry) => entry.id)).toEqual(["e1"]);
    expect(loadEntries(db, "h1", "si.unlinked_at is null").map((entry) => entry.id)).toEqual(["e2"]);
    expect(loadEntries(db, "h1", "si.unlinked_at is not null").map((entry) => entry.id)).toEqual(["e1"]);
    db.close();
  });

  it("reports mismatched amounts and invalid member identities in malformed groups", () => {
    const db = setup();
    db.exec("drop trigger ledger_share_update_total_check; drop trigger ledger_share_identity_immutable;");
    db.prepare("update ledger_shares set amount_minor = 61 where entry_id = 'e1' and member_key = 'chelsea'").run();
    expect(() => loadEntries(db, "h1")).toThrow(/corruption.*e1/i);
    db.close();
  });
});
