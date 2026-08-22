import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startFakeYnabServer, FAKE_PORT } from "./fake-ynab-server";
import { createDatabase } from "../app/db/database.server";

function portFromEnv(name: string, fallback: number): number {
  const value = process.env[name] ?? String(fallback);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${name} must be an integer from 1 to 65535`);
  return port;
}

const appPort = portFromEnv("E2E_APP_PORT", 3000);
const fakePort = portFromEnv("E2E_FAKE_PORT", FAKE_PORT);
const appOrigin = `http://127.0.0.1:${appPort}`;
const databaseDirectory = mkdtempSync(join(tmpdir(), "ynab-splits-e2e-"));
const databasePath = join(databaseDirectory, "app.sqlite");
function resetDatabase(): void {
  const db = createDatabase(databasePath);
  try {
    db.transaction(() => {
      db.exec("DELETE FROM ynab_postings; DELETE FROM manual_ynab_tasks; DELETE FROM ynab_transaction_decisions; DELETE FROM settlement_items; DELETE FROM settlements; DELETE FROM ledger_entries; DELETE FROM category_assignments; DELETE FROM source_accounts; DELETE FROM plan_settings; DELETE FROM invites; DELETE FROM memberships; DELETE FROM households; DELETE FROM oauth_connections; DELETE FROM users;");
    })();
  } finally {
    db.close();
  }
}
const fake = startFakeYnabServer({ port: fakePort, identity: "adam", onReset: resetDatabase });
const preload = resolve("e2e/fake-fetch.mjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--import ${preload}`].filter(Boolean).join(" ");
const instanceId = process.env.INSTANCE_ID ?? "e2e";
const instanceLabel = process.env.INSTANCE_LABEL ?? "e2e";
const cookiePrefix = process.env.COOKIE_PREFIX ?? `ynab_splits_${instanceId}`;
const app = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", String(appPort)], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_ORIGIN: appOrigin,
    DATABASE_PATH: databasePath,
    SESSION_SECRET: "e2e-session-secret-with-at-least-32-bytes",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    YNAB_CLIENT_ID: "e2e-client-id",
    YNAB_CLIENT_SECRET: "e2e-client-secret",
    HOST: "127.0.0.1",
    PORT: String(appPort),
    INSTANCE_ID: instanceId,
    INSTANCE_LABEL: instanceLabel,
    COOKIE_PREFIX: cookiePrefix,
    E2E_FAKE_YNAB_ORIGIN: fake.origin,
    E2E_FAKE_API_ORIGIN: fake.origin,
    E2E_FAKE_OAUTH_ORIGIN: fake.origin,
    YNAB_API_ORIGIN: `${fake.origin}/v1`,
    YNAB_OAUTH_ORIGIN: fake.origin,
    NODE_OPTIONS: nodeOptions,
  },
});

function stop(): void {
  app.kill("SIGTERM");
  fake.server.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
app.once("exit", (code, signal) => {
  fake.server.close();
  process.exitCode = code ?? (signal ? 1 : 0);
});
