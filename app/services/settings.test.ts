import { describe, expect, it } from "vitest";
import { createDatabase } from "../db/database.server";
import { disconnectYnab, savePlanSettings, setSourceAccounts, validatePlanSelections } from "./settings.server";

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

  it("blocks a plan change while any posting is unresolved", () => {
    for (const status of ["pending", "conflict", "failed"] as const) {
      const db = setup();
      savePlanSettings(db, "u1", { planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed" });
      db.prepare("insert into ynab_postings (id, user_id, posting_kind, status, import_id, intended_target_json) values (?, 'u1', 'settlement', ?, ?, '{}')").run(`post-${status}`, status, `YS:${status}`);
      expect(() => savePlanSettings(db, "u1", { planId: "p2", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed" })).toThrow(/posting/i);
      expect(db.prepare("select plan_id from plan_settings where user_id = 'u1'").get()).toEqual({ plan_id: "p1" });
      db.close();
    }
  });
  it("replaces only the authenticated user's category mappings and resets them on plan change", () => {
    const db = setup();
    savePlanSettings(db, "u1", {
      planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed",
      sourceAccountIds: [" a1 ", "a1"], categoryAssignments: [{ sourceCategoryId: "src", sourceCategoryName: "Groceries", destinationCategoryId: "dest-1", destinationCategoryName: "Food" }],
    });
    savePlanSettings(db, "u2", {
      planId: "p2", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed",
      categoryAssignments: [{ sourceCategoryId: "src", sourceCategoryName: "Groceries", destinationCategoryId: "dest-2", destinationCategoryName: "Food" }],
    });
    expect(db.prepare("select destination_category_id from category_assignments where user_id = 'u1'").get()).toEqual({ destination_category_id: "dest-1" });
    expect(() => savePlanSettings(db, "u1", {
      planId: "p3", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed",
      settlementAccountId: "acct-new", splittingCategoryId: "split-new",
    })).not.toThrow();
    expect(db.prepare("select plan_id, settlement_account_id, splitting_category_id from plan_settings where user_id = 'u1'").get()).toEqual({ plan_id: "p3", settlement_account_id: null, splitting_category_id: null });
    expect(db.prepare("select count(*) as count from category_assignments where user_id = 'u1'").get()).toEqual({ count: 0 });
    expect(db.prepare("select count(*) as count from source_accounts where user_id = 'u1'").get()).toEqual({ count: 0 });
    expect(db.prepare("select destination_category_id from category_assignments where user_id = 'u2'").get()).toEqual({ destination_category_id: "dest-2" });
    db.close();
  });

  it("rejects duplicate or blank category mappings before leaving partial rows", () => {
    const db = setup();
    expect(() => savePlanSettings(db, "u1", {
      planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "detailed",
      categoryAssignments: [
        { sourceCategoryId: "src", sourceCategoryName: "One", destinationCategoryId: "d1", destinationCategoryName: "One" },
        { sourceCategoryId: "src", sourceCategoryName: "Two", destinationCategoryId: "d2", destinationCategoryName: "Two" },
      ],
    })).toThrow(/unique/i);
    expect(db.prepare("select count(*) as count from category_assignments where user_id = 'u1'").get()).toEqual({ count: 0 });
    db.close();
  });
  it("disconnects only the requested user's connection", () => {
    const db = setup();
    db.exec("insert into oauth_connections (id, user_id, encrypted_access_token, encrypted_refresh_token, access_expires_at) values ('c1', 'u1', 'a', 'r', '2099-01-01'), ('c2', 'u2', 'a', 'r', '2099-01-01')");
    disconnectYnab(db, "u1");
    expect(db.prepare("select disconnected_at from oauth_connections where user_id = 'u1'").get()).toMatchObject({ disconnected_at: expect.any(String) });
    expect(db.prepare("select disconnected_at from oauth_connections where user_id = 'u2'").get()).toEqual({ disconnected_at: null });
    db.close();
  });
  it("rejects invalid precision and leaves existing settings untouched", () => {
    const db = setup();
    savePlanSettings(db, "u1", { planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "simple" });
    for (const precision of [-1, 4, 1.5]) {
      expect(() => savePlanSettings(db, "u1", {
        planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: precision, settlementMode: "detailed",
      })).toThrow(/precision/i);
    }
    expect(db.prepare("select plan_id, currency_decimal_digits, settlement_mode from plan_settings where user_id = 'u1'").get()).toEqual({
      plan_id: "p1", currency_decimal_digits: 2, settlement_mode: "simple",
    });
    db.close();
  });

  it("replaces source accounts atomically and removes blank or duplicate IDs", () => {
    const db = setup();
    setSourceAccounts(db, "u1", [" a1 ", "", "a1", "a2", "  "]);
    expect(db.prepare("select account_id from source_accounts where user_id = 'u1' order by account_id").all()).toEqual([
      { account_id: "a1" }, { account_id: "a2" },
    ]);
    setSourceAccounts(db, "u1", ["a3"]);
    expect(db.prepare("select account_id from source_accounts where user_id = 'u1'").all()).toEqual([{ account_id: "a3" }]);
    db.close();
  });

  it("rejects a non-member before writing settings", () => {
    const db = setup();
    expect(() => savePlanSettings(db, "unknown", {
      planId: "p1", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "simple",
    })).toThrow(/household member/i);
    expect(db.prepare("select count(*) as count from plan_settings").get()).toEqual({ count: 0 });
    db.close();
  });
  it("rejects blank plan IDs and malformed currency codes", () => {
    const db = setup();
    expect(() => savePlanSettings(db, "u1", { planId: " ", currencyIsoCode: "USD", currencyDecimalDigits: 2, settlementMode: "simple" })).toThrow(/currency/i);
    expect(() => savePlanSettings(db, "u1", { planId: "p1", currencyIsoCode: "usd", currencyDecimalDigits: 2, settlementMode: "simple" })).toThrow(/currency/i);
    db.close();
  });
  it("accepts YNAB's special default plan value", () => {
    expect(() => validatePlanSelections({
      planId: "default",
      currencyIsoCode: "USD",
      currencyDecimalDigits: 2,
      settlementMode: "simple",
    }, {
      planIds: new Set(),
      accountIds: new Set(),
      categoryIds: new Set(),
    })).not.toThrow();
  });

  it("rejects account and category IDs outside the selected plan", () => {
    const catalog = {
      planIds: new Set(["p1"]),
      accountIds: new Set(["a1"]),
      categoryIds: new Set(["cat1"]),
    };
    expect(() => validatePlanSelections({
      planId: "p2",
      currencyIsoCode: "USD",
      currencyDecimalDigits: 2,
      settlementMode: "simple",
    }, catalog)).toThrow(/plan/i);
    expect(() => validatePlanSelections({
      planId: "p1",
      currencyIsoCode: "USD",
      currencyDecimalDigits: 2,
      settlementMode: "simple",
      settlementAccountId: "a2",
    }, catalog)).toThrow(/account/i);
    expect(() => validatePlanSelections({
      planId: "p1",
      currencyIsoCode: "USD",
      currencyDecimalDigits: 2,
      settlementMode: "simple",
      categoryAssignments: [{ sourceCategoryId: "source", sourceCategoryName: "Source", destinationCategoryId: "cat2", destinationCategoryName: "Other" }],
    }, catalog)).toThrow(/category/i);
  });
});
