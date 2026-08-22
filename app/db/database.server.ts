import Database from "better-sqlite3";

/** The schema is deliberately advanced only by the ordered migrations below. */
export const CURRENT_SCHEMA_VERSION = 3;

type Migration = { version: number; up: (db: Database.Database) => void };

const INITIAL_SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  ynab_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE oauth_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  disconnected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE memberships (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  member_key TEXT NOT NULL UNIQUE CHECK (member_key IN ('adam', 'chelsea')),
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  invited_member_key TEXT NOT NULL CHECK (invited_member_key IN ('adam', 'chelsea'))
);
CREATE TABLE plan_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  currency_iso_code TEXT NOT NULL,
  currency_decimal_digits INTEGER NOT NULL CHECK (currency_decimal_digits BETWEEN 0 AND 3),
  settlement_account_id TEXT,
  splitting_category_id TEXT,
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('simple', 'detailed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE source_accounts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id)
);
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  cash_member_key TEXT NOT NULL CHECK (cash_member_key IN ('adam', 'chelsea')),
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT,
  source_plan_id TEXT,
  source_transaction_id TEXT,
  source_snapshot_hash TEXT,
  legacy_key TEXT UNIQUE,
  voided_at TEXT,
  correction_of_id TEXT REFERENCES ledger_entries(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ledger_shares (
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  member_key TEXT NOT NULL CHECK (member_key IN ('adam', 'chelsea')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (entry_id, member_key)
);
CREATE TABLE category_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id)
);
CREATE TABLE ynab_transaction_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  ynab_transaction_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('shared', 'not_shared', 'dismissed')),
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  source_snapshot_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, plan_id, ynab_transaction_id)
);
CREATE TABLE manual_ynab_tasks (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES ynab_transaction_decisions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('action_needed', 'verified', 'dismissed')),
  intended_target_json TEXT NOT NULL,
  remote_readback_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX one_action_needed_manual_task
  ON manual_ynab_tasks(decision_id) WHERE status = 'action_needed';
CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  debtor_member_key TEXT,
  creditor_member_key TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'voided', 'closed')),
  acknowledged_payment_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE settlement_items (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(id),
  PRIMARY KEY (settlement_id, ledger_entry_id)
);
CREATE TABLE ynab_postings (
  id TEXT PRIMARY KEY,
  settlement_id TEXT REFERENCES settlements(id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES ynab_transaction_decisions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posting_kind TEXT NOT NULL CHECK (posting_kind IN ('settlement', 'source')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'conflict', 'failed', 'skipped')),
  import_id TEXT NOT NULL UNIQUE,
  intended_target_json TEXT NOT NULL,
  remote_transaction_id TEXT,
  remote_readback_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (settlement_id, user_id)
);
CREATE TRIGGER ledger_share_total_check
AFTER INSERT ON ledger_shares
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.entry_id) = 2
    AND (SELECT SUM(amount_minor) FROM ledger_shares WHERE entry_id = NEW.entry_id) != (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'ledger shares must sum to entry amount') END;
END;
`;

const INITIAL_COLUMNS: Record<string, string[]> = {
  users: ["id", "ynab_user_id", "display_name", "created_at"],
  oauth_connections: [
    "id",
    "user_id",
    "encrypted_access_token",
    "encrypted_refresh_token",
    "access_expires_at",
    "disconnected_at",
    "created_at",
    "updated_at",
  ],
  households: ["id", "name", "created_at"],
  memberships: ["household_id", "user_id", "member_key"],
  invites: ["id", "household_id", "token_hash", "expires_at", "consumed_at", "invited_member_key"],
  plan_settings: [
    "user_id",
    "plan_id",
    "currency_iso_code",
    "currency_decimal_digits",
    "settlement_account_id",
    "splitting_category_id",
    "settlement_mode",
    "updated_at",
  ],
  source_accounts: ["user_id", "account_id"],
  ledger_entries: [
    "id",
    "household_id",
    "kind",
    "amount_minor",
    "cash_member_key",
    "entry_date",
    "description",
    "category_id",
    "source_plan_id",
    "source_transaction_id",
    "source_snapshot_hash",
    "legacy_key",
    "voided_at",
    "correction_of_id",
    "created_at",
  ],
  ledger_shares: ["entry_id", "member_key", "amount_minor"],
  category_assignments: ["user_id", "category_id", "category_name"],
  ynab_transaction_decisions: [
    "id",
    "user_id",
    "plan_id",
    "ynab_transaction_id",
    "decision",
    "ledger_entry_id",
    "source_snapshot_hash",
    "created_at",
  ],
  manual_ynab_tasks: [
    "id",
    "decision_id",
    "status",
    "intended_target_json",
    "remote_readback_json",
    "last_error",
    "created_at",
    "updated_at",
  ],
  settlements: [
    "id",
    "household_id",
    "start_date",
    "end_date",
    "debtor_member_key",
    "creditor_member_key",
    "amount_minor",
    "status",
    "acknowledged_payment_at",
    "created_at",
  ],
  settlement_items: ["settlement_id", "ledger_entry_id"],
  ynab_postings: [
    "id",
    "settlement_id",
    "decision_id",
    "user_id",
    "posting_kind",
    "status",
    "import_id",
    "intended_target_json",
    "remote_transaction_id",
    "remote_readback_json",
    "last_error",
    "created_at",
    "updated_at",
  ],
};

const TABLE_NAMES = Object.keys(INITIAL_COLUMNS);

function assertLegacyShape(db: Database.Database, withSnapshot: boolean): void {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const expectedTables = [...TABLE_NAMES].sort();
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables))
    throw new Error("cannot baseline unknown or partial SQLite schema");
  for (const table of TABLE_NAMES) {
    const expected = [...INITIAL_COLUMNS[table]];
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
    if (table === "ynab_transaction_decisions" && withSnapshot) expected.push("source_snapshot_json");
    if (JSON.stringify(columns) !== JSON.stringify(expected))
      throw new Error(`cannot baseline unfamiliar columns in ${table}`);
  }
  const indexes = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
  if (JSON.stringify(indexes) !== JSON.stringify(["one_action_needed_manual_task"]))
    throw new Error("cannot baseline unfamiliar SQLite indexes");
  const triggers = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string }>
  ).map((row) => row.name);
  if (JSON.stringify(triggers) !== JSON.stringify(["ledger_share_total_check"]))
    throw new Error("cannot baseline unfamiliar SQLite triggers");
}
export function validateLedgerInvariants(db: Database.Database): void {
  const rows = db
    .prepare(
      `
    SELECT e.id, e.amount_minor, e.cash_member_key, s.member_key, s.amount_minor AS share_minor
    FROM ledger_entries e
    LEFT JOIN ledger_shares s ON s.entry_id = e.id
    ORDER BY e.id, s.member_key
  `,
    )
    .all() as Array<{
    id: string;
    amount_minor: number;
    cash_member_key: string;
    member_key: "adam" | "chelsea" | null;
    share_minor: number | null;
  }>;
  const grouped = new Map<
    string,
    { amount: number; cashMember: string; shares: Array<{ member: string; amount: number }> }
  >();
  for (const row of rows) {
    const item = grouped.get(row.id) ?? { amount: row.amount_minor, cashMember: row.cash_member_key, shares: [] };
    if (row.member_key !== null) item.shares.push({ member: row.member_key, amount: row.share_minor as number });
    grouped.set(row.id, item);
  }
  for (const [id, item] of grouped) {
    const members = item.shares.map((share) => share.member).sort();
    const safeAmounts =
      Number.isSafeInteger(item.amount) &&
      item.amount > 0 &&
      item.shares.every((share) => Number.isSafeInteger(share.amount) && share.amount >= 0);
    const sharesMatchAmount =
      safeAmounts && BigInt(item.shares[0]?.amount ?? 0) + BigInt(item.shares[1]?.amount ?? 0) === BigInt(item.amount);
    if (
      members.length !== 2 ||
      members[0] !== "adam" ||
      members[1] !== "chelsea" ||
      !item.shares.some((share) => share.member === item.cashMember) ||
      !safeAmounts ||
      !sharesMatchAmount
    ) {
      throw new Error(
        `ledger corruption: entry ${id} must have exactly one Adam and one Chelsea share summing to its amount`,
      );
    }
  }
}

function validateDatabase(db: Database.Database): void {
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
  const foreignKeys = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length !== 0) throw new Error("SQLite foreign-key check failed");
  validateLedgerInvariants(db);
}

const migrations: Migration[] = [
  { version: 1, up: (db) => db.exec(INITIAL_SCHEMA) },
  { version: 2, up: (db) => db.exec("ALTER TABLE ynab_transaction_decisions ADD COLUMN source_snapshot_json TEXT") },
  {
    version: 3,
    up: (db) => {
      db.exec("DROP TRIGGER ledger_share_total_check");
      db.exec(`
        ALTER TABLE memberships RENAME TO memberships_legacy;
        CREATE TABLE memberships (
          household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          member_key TEXT NOT NULL CHECK (member_key IN ('adam', 'chelsea')),
          PRIMARY KEY (household_id, user_id),
          UNIQUE (household_id, member_key)
        );
        INSERT INTO memberships (household_id, user_id, member_key) SELECT household_id, user_id, member_key FROM memberships_legacy;
        DROP TABLE memberships_legacy;

        ALTER TABLE category_assignments RENAME TO category_assignments_legacy;
        CREATE TABLE category_assignments (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_category_id TEXT NOT NULL,
          source_category_name TEXT NOT NULL,
          destination_category_id TEXT NOT NULL,
          destination_category_name TEXT NOT NULL,
          PRIMARY KEY (user_id, source_category_id)
        );
        INSERT INTO category_assignments (user_id, source_category_id, source_category_name, destination_category_id, destination_category_name)
          SELECT user_id, category_id, category_name, category_id, category_name FROM category_assignments_legacy;
        DROP TABLE category_assignments_legacy;

        ALTER TABLE settlement_items RENAME TO settlement_items_legacy;
        CREATE TABLE settlement_items (
          settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
          ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
          unlinked_at TEXT,
          PRIMARY KEY (settlement_id, ledger_entry_id)
        );
        INSERT INTO settlement_items (settlement_id, ledger_entry_id, unlinked_at)
          SELECT si.settlement_id, si.ledger_entry_id, CASE WHEN s.status = 'voided' THEN COALESCE(s.created_at, CURRENT_TIMESTAMP) ELSE NULL END
          FROM settlement_items_legacy si JOIN settlements s ON s.id = si.settlement_id;
        DROP TABLE settlement_items_legacy;
        CREATE UNIQUE INDEX one_active_settlement_item ON settlement_items(ledger_entry_id) WHERE unlinked_at IS NULL;
        UPDATE settlements SET status = 'closed' WHERE status = 'open' AND acknowledged_payment_at IS NOT NULL;

        CREATE TRIGGER ledger_share_identity_immutable
        BEFORE UPDATE OF member_key ON ledger_shares
        WHEN NEW.member_key <> OLD.member_key
        BEGIN SELECT RAISE(ABORT, 'ledger share identity cannot change'); END;
        CREATE TRIGGER ledger_share_total_check
        AFTER INSERT ON ledger_shares
        BEGIN
          SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.entry_id) = 2
            AND (SELECT SUM(amount_minor) FROM ledger_shares WHERE entry_id = NEW.entry_id) != (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
            THEN RAISE(ABORT, 'ledger shares must sum to entry amount') END;
        END;
        CREATE TRIGGER ledger_share_update_total_check
        AFTER UPDATE OF amount_minor ON ledger_shares
        BEGIN
          SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.entry_id) = 2
            AND (SELECT SUM(amount_minor) FROM ledger_shares WHERE entry_id = NEW.entry_id) != (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
            THEN RAISE(ABORT, 'ledger shares must sum to entry amount') END;
        END;
        CREATE TRIGGER ledger_parent_amount_check
        AFTER UPDATE OF amount_minor ON ledger_entries
        WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.id) > 0
        BEGIN
          SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.id) != 2
            OR (SELECT SUM(amount_minor) FROM ledger_shares WHERE entry_id = NEW.id) != NEW.amount_minor
            THEN RAISE(ABORT, 'ledger shares must sum to entry amount') END;
        END;
        CREATE TRIGGER ledger_share_delete_check
        BEFORE DELETE ON ledger_shares
        WHEN EXISTS (SELECT 1 FROM ledger_entries WHERE id = OLD.entry_id)
        BEGIN SELECT RAISE(ABORT, 'ledger shares cannot be deleted while the parent exists'); END;
      `);
      validateLedgerInvariants(db);
    },
  },
];

function rollback(db: Database.Database): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* transaction may not have started */
  }
}

function applyMigration(db: Database.Database, migration: Migration): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    migration.up(db);
    validateDatabase(db);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)").run(
      migration.version,
    );
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

function ensureMigrationTable(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
}

function readMigrationVersion(db: Database.Database): number {
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].version !== i + 1) throw new Error("SQLite schema migration history is gapped or invalid");
  }
  const version = rows.at(-1)?.version ?? 0;
  if (version > CURRENT_SCHEMA_VERSION)
    throw new Error(`SQLite schema version ${version} is newer than this application`);
  return version;
}

export type AppDatabase = Database.Database;

export function withLedgerTransaction<T>(db: AppDatabase, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    validateLedgerInvariants(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollback(db);
    throw error;
  }
}

export function createDatabase(filename: string): AppDatabase {
  const db = new Database(filename);
  try {
    db.pragma("foreign_keys = ON");
    if (filename !== ":memory:") db.pragma("journal_mode = WAL");

    const userTables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    const hasMigrations = userTables.includes("schema_migrations");
    if (!hasMigrations && userTables.length > 0) {
      let baseline = 0;
      try {
        assertLegacyShape(db, true);
        baseline = 2;
      } catch {
        assertLegacyShape(db, false);
        baseline = 1;
      }
      ensureMigrationTable(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (let version = 1; version <= baseline; version += 1) {
          db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)").run(version);
        }
        db.exec("COMMIT");
      } catch (error) {
        rollback(db);
        throw error;
      }
    } else {
      ensureMigrationTable(db);
      if (
        hasMigrations &&
        userTables.some((table) => table !== "schema_migrations") &&
        (db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count === 0
      ) {
        throw new Error("SQLite schema migration history is incomplete");
      }
    }

    let version = readMigrationVersion(db);
    for (const migration of migrations) {
      if (migration.version > version) {
        applyMigration(db, migration);
        version = migration.version;
      }
    }
    if (version !== CURRENT_SCHEMA_VERSION) throw new Error("SQLite schema did not reach the current version");
    validateDatabase(db);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      /* preserve the migration error */
    }
    throw error;
  }
}

export function getSchemaVersion(db: AppDatabase): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
  return row.version ?? 0;
}
