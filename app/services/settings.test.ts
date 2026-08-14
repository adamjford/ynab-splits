import { describe, expect, it } from "vitest";
import { createDatabase } from "../db/database.server";
import { savePlanSettings } from "./settings.server";

function setup() {
  const db = createDatabase(":memory:");
  db.exec("insert into users (id, ynab_user_id, display_name) values ('u1', 'y1', 'Adam'), ('u2', 'y2', 'Chelsea'); insert into households (id, name) values ('h1', 'Home'); insert into memberships (household_id, user_id, member_key) values ('h1', 'u1', 'adam'), ('h1', 'u2', 'chelsea');");
  return db;
}

describe("savePlanSettings", () => {
  it("rejects a second plan with a different currency", () => {
    const db = setup();
    savePlanSettings(db, "u1", { planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed" });
    expect(() => savePlanSettings(db, "u2", { planId: "p2", currencyIsoCode: "GBP", currencyDecimalDigits: 2, settlementMode: "simple" })).toThrow(/currency/i);
    db.close();
  });

  it("blocks a plan change while a posting is unresolved", () => {
    const db = setup();
    savePlanSettings(db, "u1", { planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed" });
    db.prepare("insert into settlements (id, household_id, start_date, end_date, amount_minor, status) values ('s1', 'h1', '2026-01-01', '2026-01-02', 100, 'open')").run();
    db.prepare("insert into ynab_postings (id, settlement_id, user_id, posting_kind, status, import_id, intended_target_json) values ('post1', 's1', 'u1', 'settlement', 'failed', 'YS:post1', '{}')").run();
    expect(() => savePlanSettings(db, "u1", { planId: "p2", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed" })).toThrow(/posting/i);
    db.close();
  });
});
