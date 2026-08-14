import Database from "better-sqlite3";

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  ynab_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  disconnected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memberships (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  member_key TEXT NOT NULL UNIQUE CHECK (member_key IN ('adam', 'chelsea')),
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  invited_member_key TEXT NOT NULL CHECK (invited_member_key IN ('adam', 'chelsea'))
);
CREATE TABLE IF NOT EXISTS plan_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  currency_iso_code TEXT NOT NULL,
  currency_decimal_digits INTEGER NOT NULL CHECK (currency_decimal_digits BETWEEN 0 AND 3),
  settlement_account_id TEXT,
  splitting_category_id TEXT,
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('simple', 'detailed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS source_accounts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
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
  voided_at TEXT,
  correction_of_id TEXT REFERENCES ledger_entries(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger_shares (
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  member_key TEXT NOT NULL CHECK (member_key IN ('adam', 'chelsea')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (entry_id, member_key)
);
CREATE TABLE IF NOT EXISTS category_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id)
);
CREATE TABLE IF NOT EXISTS ynab_transaction_decisions (
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
CREATE TABLE IF NOT EXISTS manual_ynab_tasks (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES ynab_transaction_decisions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('action_needed', 'verified', 'dismissed')),
  intended_target_json TEXT NOT NULL,
  remote_readback_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_action_needed_manual_task
  ON manual_ynab_tasks(decision_id) WHERE status = 'action_needed';
CREATE TABLE IF NOT EXISTS settlements (
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
CREATE TABLE IF NOT EXISTS settlement_items (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(id),
  PRIMARY KEY (settlement_id, ledger_entry_id)
);
CREATE TABLE IF NOT EXISTS ynab_postings (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE TRIGGER IF NOT EXISTS ledger_share_total_check
AFTER INSERT ON ledger_shares
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_shares WHERE entry_id = NEW.entry_id) = 2
    AND (SELECT SUM(amount_minor) FROM ledger_shares WHERE entry_id = NEW.entry_id) != (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'ledger shares must sum to entry amount') END;
END;
`;

export type AppDatabase = Database.Database;

export function createDatabase(filename: string): AppDatabase {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  return db;
}
