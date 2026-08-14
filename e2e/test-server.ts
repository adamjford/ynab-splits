import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startFakeYnabServer, FAKE_ORIGIN } from "./fake-ynab-server";

const fake = startFakeYnabServer();
const databaseDirectory = mkdtempSync(join(tmpdir(), "ynab-splits-e2e-"));
const preload = resolve("e2e/fake-fetch.mjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--import ${preload}`].filter(Boolean).join(" ");
const app = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", "3000"], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_PATH: join(databaseDirectory, "app.sqlite"),
    SESSION_SECRET: "e2e-session-secret-with-at-least-32-bytes",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    YNAB_CLIENT_ID: "e2e-client-id",
    HOST: "127.0.0.1",
    PORT: "3000",
    E2E_FAKE_YNAB_ORIGIN: FAKE_ORIGIN,
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
