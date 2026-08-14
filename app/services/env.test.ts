import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.server";

const valid = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "session-secret-that-is-at-least-32-bytes",
  TOKEN_ENCRYPTION_KEY: "abcdef0123456789abcdef0123456789",
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
