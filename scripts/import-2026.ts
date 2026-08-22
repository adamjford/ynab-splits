import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, createDatabase } from "../app/db/database.server";
import { applyLegacy2026, preflightLegacy2026 } from "../app/importer/legacy2026-apply.server";
import { parseLegacy2026 } from "../app/importer/legacy2026";

function openReadOnlyDatabase(filename: string): Database.Database {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select max(version) as version from schema_migrations").get() as { version: number | null };
    if (row.version !== CURRENT_SCHEMA_VERSION) throw new Error(`SQLite schema version ${row.version ?? 0} is not current`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function argument(...names: string[]): string | undefined {
  for (const name of names) {
    const index = process.argv.indexOf(name);
    if (index >= 0) return process.argv[index + 1];
  }
  return undefined;
}

type ImportEnvironment = "development" | "production";
type EnvFileConfig = { exists: boolean; databasePath?: string };

function databasePathFromEnvFile(filename: string): EnvFileConfig {
  let contents: string;
  try {
    contents = readFileSync(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
  const line = contents.split(/\r?\n/).find((candidate) => /^\s*(?:export\s+)?DATABASE_PATH\s*=/.test(candidate));
  if (!line) return { exists: true };
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (!value) return { exists: true };
  return { exists: true, databasePath: value.replace(/^(['"])(.*)\1$/, "$2") };
}

function resolveDatabasePath(environment: ImportEnvironment): string | undefined {
  const filenames = environment === "development" ? [".env.development", ".env"] : [".env.production"];
  for (const filename of filenames) {
    const config = databasePathFromEnvFile(join(process.cwd(), filename));
    if (config.exists) return config.databasePath;
  }
  return process.env.DATABASE_PATH;
}

const environmentAliases: Record<string, ImportEnvironment> = {
  dev: "development",
  development: "development",
  prod: "production",
  production: "production",
};

const environmentValue = argument("--environment", "--env");
const environment = environmentValue ? environmentAliases[environmentValue] : undefined;
if (!environment) {
  throw new Error("usage: pnpm import:2026 -- --environment|--env <dev|development|prod|production> --transactions <file> --split-view <file> --household <id> [--apply]");
}

const transactionsPath = argument("--transactions");
const splitViewPath = argument("--split-view");
const householdId = argument("--household");
const apply = process.argv.includes("--apply");
if (!transactionsPath || !splitViewPath || !householdId) throw new Error("usage: pnpm import:2026 -- --environment|--env <dev|development|prod|production> --transactions <file> --split-view <file> --household <id> [--apply]");

const report = parseLegacy2026(readFileSync(transactionsPath, "utf8"), readFileSync(splitViewPath, "utf8"));
const parsed = {
  rows: report.rows.length,
  transfers: report.transfers.length,
  periods: report.periods.length,
  trailingOpenPeriods: report.periods.filter((period) => period.transfer === undefined).length,
};
if (report.errors.length > 0) {
  console.error(JSON.stringify({ mode: apply ? "apply" : "dry-run", environment, parsed, validationErrors: report.errors, writes: "none" }, null, 2));
  process.exitCode = 1;
} else {
  const databasePath = resolveDatabasePath(environment);
  if (!databasePath) throw new Error(`No DATABASE_PATH configured for ${environment}; set it in the process environment or matching env file`);
  const db = apply ? createDatabase(databasePath) : openReadOnlyDatabase(databasePath);
  try {
    if (!apply) {
      const preflight = preflightLegacy2026(db, householdId, report);
      console.log(JSON.stringify({
        mode: "dry-run",
        environment,
        parsed,
        validationErrors: [],
        preflight: { insert: preflight.insert, exactSkip: preflight.skip, immutableConflict: preflight.conflict },
        preflightConflicts: preflight.conflicts,
        applyOutcome: null,
        writes: "none",
      }, null, 2));
      if (preflight.conflicts.length > 0) process.exitCode = 1;
    } else {
      const result = applyLegacy2026(db, householdId, report);
      console.log(JSON.stringify({
        mode: "apply",
        environment,
        parsed,
        validationErrors: [],
        preflight: { insert: result.preflight.insert, exactSkip: result.preflight.skip, immutableConflict: result.preflight.conflict },
        applyOutcome: { inserted: result.applied, exactSkip: result.skipped, immutableConflict: result.conflicts, blocked: result.blocked },
      }, null, 2));
      if (result.blocked) process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}
