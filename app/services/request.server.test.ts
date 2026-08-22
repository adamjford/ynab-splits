import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db/database.server";
import { createAuthCookie } from "./session.server";
import { parseEnv } from "./env.server";
import { authenticatedUser } from "./request.server";

const env = parseEnv({
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  YNAB_CLIENT_ID: "client-id",
  YNAB_CLIENT_SECRET: "client-secret",
  HOST: "127.0.0.1",
  PORT: "3000",
});

function requestFor(userId: string): Request {
  return new Request("http://localhost:3000/", {
    headers: { Cookie: createAuthCookie(userId, env) },
  });
}

describe("authenticatedUser", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires onboarding before returning household membership and selects the cookie user", () => {
    vi.stubEnv("APP_ORIGIN", env.APP_ORIGIN);
    vi.stubEnv("DATABASE_PATH", env.DATABASE_PATH);
    vi.stubEnv("SESSION_SECRET", env.SESSION_SECRET);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", env.TOKEN_ENCRYPTION_KEY);
    vi.stubEnv("YNAB_CLIENT_ID", env.YNAB_CLIENT_ID);
    vi.stubEnv("YNAB_CLIENT_SECRET", env.YNAB_CLIENT_SECRET);

    const db = createDatabase(":memory:");
    try {
      db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run(
        "pending",
        "ynab-pending",
        "Pending",
      );
      db.prepare("insert into users (id, ynab_user_id, display_name) values (?, ?, ?)").run(
        "second",
        "ynab-second",
        "Second",
      );

      expect(() => authenticatedUser(requestFor("pending"), db)).toThrowError(expect.objectContaining({ status: 409 }));

      db.prepare("insert into households (id, name) values (?, ?)").run("household", "Household");
      db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run(
        "household",
        "pending",
        "adam",
      );
      db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run(
        "household",
        "second",
        "chelsea",
      );
      expect(authenticatedUser(requestFor("pending"), db)).toEqual({
        id: "pending",
        displayName: "Pending",
        householdId: "household",
        memberKey: "adam",
      });
      expect(authenticatedUser(requestFor("second"), db)).toEqual({
        id: "second",
        displayName: "Second",
        householdId: "household",
        memberKey: "chelsea",
      });
    } finally {
      db.close();
    }
  });
});
