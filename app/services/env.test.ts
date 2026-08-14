import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.server";

const valid = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "session-secret",
  TOKEN_ENCRYPTION_KEY: "01234567890123456789012345678901",
  YNAB_CLIENT_ID: "client-id",
  YNAB_CLIENT_SECRET: "client-secret",
};

describe("parseEnv", () => {
  it("applies host and port defaults", () => {
    expect(parseEnv(valid)).toMatchObject({ HOST: "0.0.0.0", PORT: 3000 });
  });

  it("rejects missing required secrets", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/i);
  });
});
