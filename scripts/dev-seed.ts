import { createDatabase } from "../app/db/database.server";
import { getInstancePaths, resetInstanceDatabase, validateInstanceId } from "./dev-reset";

export function seedInstanceDatabase(idValue: string, cwd = process.cwd()): void {
  const id = validateInstanceId(idValue);
  resetInstanceDatabase(id, cwd);
  const paths = getInstancePaths(id, cwd);
  const db = createDatabase(paths.database, id);
  try {
    const seed = db.transaction(() => {
      db.prepare("INSERT INTO users (id, ynab_user_id, display_name) VALUES (?, ?, ?), (?, ?, ?)").run(
        "dev-user-adam", "fake-user-adam", "Adam",
        "dev-user-chelsea", "fake-user-chelsea", "Chelsea",
      );
      db.prepare("INSERT INTO households (id, name) VALUES (?, ?)").run("dev-household", "Development household");
      db.prepare("INSERT INTO memberships (household_id, user_id, member_key) VALUES (?, ?, ?), (?, ?, ?)").run(
        "dev-household", "dev-user-adam", "adam",
        "dev-household", "dev-user-chelsea", "chelsea",
      );

      const plan = db.prepare(`
        INSERT INTO plan_settings
          (user_id, plan_id, currency_iso_code, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode)
        VALUES (?, ?, 'USD', 2, ?, ?, 'detailed'), (?, ?, 'USD', 2, ?, ?, 'detailed')
      `);
      plan.run(
        "dev-user-adam", "fake-plan-adam", "fake-account-adam", "fake-category-splitting-adam",
        "dev-user-chelsea", "fake-plan-chelsea", "fake-account-chelsea", "fake-category-splitting-chelsea",
      );
      db.prepare("INSERT INTO source_accounts (user_id, account_id) VALUES (?, ?), (?, ?)").run(
        "dev-user-adam", "fake-account-adam",
        "dev-user-chelsea", "fake-account-chelsea",
      );
      db.prepare(`
        INSERT INTO category_assignments
          (user_id, source_category_id, source_category_name, destination_category_id, destination_category_name)
        VALUES (?, ?, 'Groceries', ?, 'Groceries'), (?, ?, 'Groceries', ?, 'Groceries')
      `).run(
        "dev-user-adam", "fake-category-groceries-adam", "fake-category-groceries-adam",
        "dev-user-chelsea", "fake-category-groceries-chelsea", "fake-category-groceries-chelsea",
      );

      db.prepare(`
        INSERT INTO ledger_entries
          (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id, source_plan_id, source_transaction_id)
        VALUES (?, 'dev-household', 'expense', 18890, 'adam', '2026-08-01', 'Local market', 'fake-category-groceries-adam', 'fake-plan-adam', 'fake-transaction-adam-1'),
               (?, 'dev-household', 'expense', 11540, 'chelsea', '2026-08-02', 'Corner shop', 'fake-category-groceries-chelsea', 'fake-plan-chelsea', 'fake-transaction-chelsea-1')
      `).run("dev-entry-adam", "dev-entry-chelsea");
      db.prepare("INSERT INTO ledger_shares (entry_id, member_key, amount_minor) VALUES (?, 'adam', 9445), (?, 'chelsea', 9445), (?, 'adam', 5770), (?, 'chelsea', 5770)").run(
        "dev-entry-adam", "dev-entry-adam", "dev-entry-chelsea", "dev-entry-chelsea",
      );
    });
    seed();
  } finally {
    db.close();
  }
}

function parseId(args: string[]): string {
  let id: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--id") {
      id = args[++index];
    } else if (arg.startsWith("--id=")) {
      id = arg.slice("--id=".length);
    } else if (arg === "--" || arg === "") {
      continue;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!id) throw new Error("usage: pnpm dev:seed -- --id <instance-id>");
  return validateInstanceId(id);
}

export function main(argv = process.argv.slice(2)): void {
  const id = parseId(argv);
  seedInstanceDatabase(id);
  console.log(`Seeded development instance ${id}`);
}

if (process.argv[1]?.endsWith("dev-seed.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
