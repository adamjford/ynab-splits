import type { AppDatabase } from "../db/database.server";

export interface PlanSettingsInput {
  planId: string;
  currencyIsoCode: string;
  currencyDecimalDigits: number;
  settlementAccountId?: string;
  splittingCategoryId?: string;
  settlementMode: "simple" | "detailed";
}

function userHouseholdId(db: AppDatabase, userId: string): string {
  const row = db.prepare("select household_id from memberships where user_id = ?").get(userId) as { household_id: string } | undefined;
  if (!row) throw new Error("user is not a household member");
  return row.household_id;
}

export function savePlanSettings(db: AppDatabase, userId: string, input: PlanSettingsInput): void {
  if (!Number.isInteger(input.currencyDecimalDigits) || input.currencyDecimalDigits < 0 || input.currencyDecimalDigits > 3) throw new Error("invalid currency precision");
  const householdId = userHouseholdId(db, userId);
  const transaction = db.transaction(() => {
    const unresolved = db.prepare(`select 1 from ynab_postings p
      join settlements s on s.id = p.settlement_id
      where p.user_id = ? and p.status in ('pending', 'conflict', 'failed') limit 1`).get(userId);
    if (unresolved) throw new Error("cannot change plan while a YNAB posting is unresolved");

    const other = db.prepare(`select ps.currency_iso_code, ps.currency_decimal_digits from plan_settings ps
      join memberships m on m.user_id = ps.user_id where m.household_id = ? and ps.user_id != ? limit 1`).get(householdId, userId) as { currency_iso_code: string; currency_decimal_digits: number } | undefined;
    if (other && (other.currency_iso_code !== input.currencyIsoCode || other.currency_decimal_digits !== input.currencyDecimalDigits)) throw new Error("household plans must use the same currency");

    const previous = db.prepare("select plan_id from plan_settings where user_id = ?").get(userId) as { plan_id: string } | undefined;
    if (previous && previous.plan_id !== input.planId) {
      db.prepare("delete from source_accounts where user_id = ?").run(userId);
      db.prepare("delete from category_assignments where user_id = ?").run(userId);
      input.settlementAccountId = undefined;
      input.splittingCategoryId = undefined;
    }
    db.prepare(`insert into plan_settings (user_id, plan_id, currency_iso_code, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(user_id) do update set plan_id = excluded.plan_id, currency_iso_code = excluded.currency_iso_code,
      currency_decimal_digits = excluded.currency_decimal_digits, settlement_account_id = excluded.settlement_account_id,
      splitting_category_id = excluded.splitting_category_id, settlement_mode = excluded.settlement_mode,
      updated_at = CURRENT_TIMESTAMP`).run(userId, input.planId, input.currencyIsoCode, input.currencyDecimalDigits, input.settlementAccountId ?? null, input.splittingCategoryId ?? null, input.settlementMode);
  });
  transaction();
}

export function setSourceAccounts(db: AppDatabase, userId: string, accountIds: string[]): void {
  const transaction = db.transaction(() => {
    db.prepare("delete from source_accounts where user_id = ?").run(userId);
    const insert = db.prepare("insert into source_accounts (user_id, account_id) values (?, ?)");
    for (const accountId of new Set(accountIds)) insert.run(userId, accountId);
  });
  transaction();
}
