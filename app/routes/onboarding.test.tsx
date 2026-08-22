import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "~/db/database.server";
import { parseEnv } from "~/services/env.server";
import { createAuthCookie } from "~/services/session.server";
import { action } from "./onboarding";

const secretEnv = {
  APP_ORIGIN: "http://localhost:3000",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  YNAB_CLIENT_ID: "client-id",
  YNAB_CLIENT_SECRET: "client-secret",
  HOST: "127.0.0.1",
  PORT: "3000",
};

function stubEnvironment(databasePath: string) {
  const env = parseEnv({ ...secretEnv, DATABASE_PATH: databasePath });
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, String(value));
  return env;
}

describe("onboarding action", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("restarts OAuth instead of inserting a membership for a missing user", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ynab-splits-onboarding-"));
    const databasePath = join(directory, "app.sqlite");

    try {
      const env = stubEnvironment(databasePath);
      const db = createDatabase(databasePath);
      db.close();

      const request = new Request("http://localhost:3000/onboarding", {
        method: "POST",
        headers: {
          Cookie: createAuthCookie("missing-user", env),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "displayName=Adam",
      });
      const response = (await action({ request } as never)) as Response;

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/ynab/start");
      expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");

      const verificationDb = createDatabase(databasePath);
      try {
        expect(verificationDb.prepare("select count(*) as count from users").get()).toEqual({ count: 0 });
        expect(verificationDb.prepare("select count(*) as count from memberships").get()).toEqual({ count: 0 });
      } finally {
        verificationDb.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
