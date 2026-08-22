import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createDatabase } from "../app/db/database.server";

export const INSTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
export const INSTANCE_ROOT_NAME = ".local/instances";
export type InstancePaths = {
  root: string;
  directory: string;
  database: string;
  metadata: string;
  secrets: string;
};

export function validateInstanceId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || !INSTANCE_ID_PATTERN.test(value)) {
    throw new Error("instance id must be a lowercase slug (letters, numbers, '-' or '_')");
  }
  return value;
}

function rejectSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing symlinked development instance path: ${path}`);
  }
}

function ensureDirectory(path: string): void {
  rejectSymlink(path);
  mkdirSync(path, { recursive: true });
  rejectSymlink(path);
}

function assertUnderRoot(root: string, path: string): void {
  const remainder = relative(root, path);
  if (remainder === "" || remainder.startsWith("..") || isAbsolute(remainder)) {
    throw new Error("development instance path escapes the instance root");
  }
}

export function getInstancePaths(idValue: string, cwd = process.cwd()): InstancePaths {
  const id = validateInstanceId(idValue);
  const root = resolve(cwd, INSTANCE_ROOT_NAME);
  const directory = resolve(root, id);
  assertUnderRoot(root, directory);

  const localRoot = dirname(root);
  rejectSymlink(localRoot);
  ensureDirectory(localRoot);
  rejectSymlink(root);
  ensureDirectory(root);
  rejectSymlink(directory);
  ensureDirectory(directory);

  const paths = {
    root,
    directory,
    database: resolve(directory, "app.sqlite"),
    metadata: resolve(directory, "instance.json"),
    secrets: resolve(directory, "secrets.json"),
  };
  rejectSymlink(paths.database);
  rejectSymlink(paths.metadata);
  rejectSymlink(paths.secrets);
  return paths;
}

const RESET_TABLES = [
  "ynab_postings",
  "manual_ynab_tasks",
  "ynab_transaction_decisions",
  "settlement_items",
  "settlements",
  "ledger_entries",
  "ledger_shares",
  "category_assignments",
  "source_accounts",
  "plan_settings",
  "invites",
  "memberships",
  "households",
  "oauth_connections",
  "users",
] as const;

export function resetInstanceDatabase(idValue: string, cwd = process.cwd()): void {
  const id = validateInstanceId(idValue);
  const paths = getInstancePaths(id, cwd);
  const db = createDatabase(paths.database, id);
  try {
    const clear = db.transaction(() => {
      for (const table of RESET_TABLES) db.prepare(`DELETE FROM ${table}`).run();
    });
    clear();
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
  if (!id) throw new Error("usage: pnpm dev:reset -- --id <instance-id>");
  return validateInstanceId(id);
}

export function main(argv = process.argv.slice(2)): void {
  const id = parseId(argv);
  resetInstanceDatabase(id);
  console.log(`Reset development instance ${id}`);
}

if (process.argv[1]?.endsWith("dev-reset.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
