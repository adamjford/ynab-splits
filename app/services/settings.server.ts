import type { AppDatabase } from "../db/database.server";

export interface CategoryAssignmentInput {
  sourceCategoryId: string;
  sourceCategoryName: string;
  destinationCategoryId: string;
  destinationCategoryName: string;
}

export interface PlanSettingsInput {
  planId: string;
  currencyIsoCode: string;
  currencyDecimalDigits: number;
  settlementAccountId?: string;
  splittingCategoryId?: string;
  settlementMode: "simple" | "detailed";
  sourceAccountIds?: string[];
  categoryAssignments?: CategoryAssignmentInput[];
}

export interface PlanSelectionCatalog {
  planIds: ReadonlySet<string>;
  accountIds: ReadonlySet<string>;
  categoryIds: ReadonlySet<string>;
}

export function validatePlanSelections(input: PlanSettingsInput, catalog: PlanSelectionCatalog): void {
  if (input.planId !== "default" && !catalog.planIds.has(input.planId))
    throw new Error("selected YNAB plan was not found");
  const accountIds = [input.settlementAccountId, ...(input.sourceAccountIds ?? [])]
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => id.trim());
  if (accountIds.some((id) => !catalog.accountIds.has(id)))
    throw new Error("selected account does not belong to the selected YNAB plan");
  if (input.splittingCategoryId?.trim() && !catalog.categoryIds.has(input.splittingCategoryId.trim()))
    throw new Error("selected splitting category does not belong to the selected YNAB plan");
  if (
    (input.categoryAssignments ?? []).some(
      (assignment) => !catalog.categoryIds.has(assignment.destinationCategoryId.trim()),
    )
  ) {
    throw new Error("selected destination category does not belong to the selected YNAB plan");
  }
}

function userHouseholdId(db: AppDatabase, userId: string): string {
  const row = db.prepare("select household_id from memberships where user_id = ?").get(userId) as
    { household_id: string } | undefined;
  if (!row) throw new Error("user is not a household member");
  return row.household_id;
}

function unresolvedPosting(db: AppDatabase, userId: string): boolean {
  return Boolean(
    db
      .prepare(
        `
    select 1 from ynab_postings
    where user_id = ? and status in ('pending', 'conflict', 'failed')
    limit 1
  `,
      )
      .get(userId),
  );
}

function saveAssignments(db: AppDatabase, userId: string, assignments: CategoryAssignmentInput[]): void {
  db.prepare("delete from category_assignments where user_id = ?").run(userId);
  const insert = db.prepare(`
    insert into category_assignments
      (user_id, source_category_id, source_category_name, destination_category_id, destination_category_name)
    values (?, ?, ?, ?, ?)
  `);
  const seen = new Set<string>();
  for (const item of assignments) {
    const sourceId = item.sourceCategoryId.trim();
    const destinationId = item.destinationCategoryId.trim();
    if (!sourceId || !destinationId || seen.has(sourceId))
      throw new Error("category mappings must have unique, nonempty IDs");
    seen.add(sourceId);
    insert.run(userId, sourceId, item.sourceCategoryName.trim(), destinationId, item.destinationCategoryName.trim());
  }
}

/**
 * Persist the entire plan-local settings aggregate in one transaction. A plan
 * change resets account/category selections atomically while leaving immutable
 * source IDs on historical ledger rows and decisions untouched.
 */
export function savePlanSettings(db: AppDatabase, userId: string, input: PlanSettingsInput): void {
  if (!input.planId.trim() || !/^[A-Z]{3}$/.test(input.currencyIsoCode)) throw new Error("invalid currency");
  if (
    !Number.isInteger(input.currencyDecimalDigits) ||
    input.currencyDecimalDigits < 0 ||
    input.currencyDecimalDigits > 3
  )
    throw new Error("invalid currency precision");
  const householdId = userHouseholdId(db, userId);
  db.transaction(() => {
    const previous = db.prepare("select plan_id from plan_settings where user_id = ?").get(userId) as
      { plan_id: string } | undefined;
    const planChanged = Boolean(previous && previous.plan_id !== input.planId);
    if (planChanged && unresolvedPosting(db, userId))
      throw new Error("cannot change plan while a YNAB posting is unresolved");

    const other = db
      .prepare(
        `
      select ps.currency_iso_code, ps.currency_decimal_digits
      from plan_settings ps join memberships m on m.user_id = ps.user_id
      where m.household_id = ? and ps.user_id != ? limit 1
    `,
      )
      .get(householdId, userId) as { currency_iso_code: string; currency_decimal_digits: number } | undefined;
    if (
      other &&
      (other.currency_iso_code !== input.currencyIsoCode ||
        other.currency_decimal_digits !== input.currencyDecimalDigits)
    )
      throw new Error("household plans must use the same currency");

    if (planChanged) {
      db.prepare("delete from source_accounts where user_id = ?").run(userId);
      db.prepare("delete from category_assignments where user_id = ?").run(userId);
    }
    db.prepare(
      `
      insert into plan_settings
        (user_id, plan_id, currency_iso_code, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(user_id) do update set plan_id = excluded.plan_id,
        currency_iso_code = excluded.currency_iso_code,
        currency_decimal_digits = excluded.currency_decimal_digits,
        settlement_account_id = excluded.settlement_account_id,
        splitting_category_id = excluded.splitting_category_id,
        settlement_mode = excluded.settlement_mode,
        updated_at = CURRENT_TIMESTAMP
    `,
    ).run(
      userId,
      input.planId,
      input.currencyIsoCode,
      input.currencyDecimalDigits,
      planChanged ? null : (input.settlementAccountId ?? null),
      planChanged ? null : (input.splittingCategoryId ?? null),
      input.settlementMode,
    );

    if (!planChanged && input.sourceAccountIds) {
      db.prepare("delete from source_accounts where user_id = ?").run(userId);
      const insert = db.prepare("insert into source_accounts (user_id, account_id) values (?, ?)");
      for (const accountId of new Set(input.sourceAccountIds.map((id) => id.trim()).filter(Boolean)))
        insert.run(userId, accountId);
    }
    if (!planChanged && input.categoryAssignments) saveAssignments(db, userId, input.categoryAssignments);
  })();
}

export function setSourceAccounts(db: AppDatabase, userId: string, accountIds: string[]): void {
  db.transaction(() => {
    db.prepare("delete from source_accounts where user_id = ?").run(userId);
    const insert = db.prepare("insert into source_accounts (user_id, account_id) values (?, ?)");
    for (const accountId of new Set(accountIds.map((id) => id.trim()).filter(Boolean))) insert.run(userId, accountId);
  })();
}

export function disconnectYnab(db: AppDatabase, userId: string): void {
  db.prepare("update oauth_connections set disconnected_at = CURRENT_TIMESTAMP where user_id = ?").run(userId);
}
