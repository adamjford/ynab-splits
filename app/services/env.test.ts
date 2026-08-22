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
  it("applies runtime defaults", () => {
    expect(parseEnv(valid)).toMatchObject({
      HOST: "0.0.0.0",
      PORT: 3000,
      INSTANCE_ID: "default",
      INSTANCE_LABEL: "",
      COOKIE_PREFIX: "ynab_splits",
      YNAB_API_ORIGIN: "https://api.ynab.com/v1",
      YNAB_OAUTH_ORIGIN: "https://app.ynab.com",
    });
  });

  it("accepts validated per-instance values", () => {
    expect(parseEnv({
      ...valid,
      INSTANCE_ID: "worktree-2",
      INSTANCE_LABEL: "Worktree 2",
      COOKIE_PREFIX: "ynab_worktree_2",
      YNAB_API_ORIGIN: "http://127.0.0.1:4310/v1",
      YNAB_OAUTH_ORIGIN: "http://127.0.0.1:4310",
    })).toMatchObject({
      INSTANCE_ID: "worktree-2",
      INSTANCE_LABEL: "Worktree 2",
      COOKIE_PREFIX: "ynab_worktree_2",
      YNAB_API_ORIGIN: "http://127.0.0.1:4310/v1",
      YNAB_OAUTH_ORIGIN: "http://127.0.0.1:4310",
    });
  });

  it.each([
    ["INSTANCE_ID", ""],
    ["INSTANCE_ID", "../other"],
    ["INSTANCE_ID", "work/tree"],
    ["INSTANCE_ID", "a".repeat(65)],
    ["COOKIE_PREFIX", ""],
    ["COOKIE_PREFIX", "../other"],
    ["COOKIE_PREFIX", "work\\tree"],
    ["COOKIE_PREFIX", "a".repeat(65)],
  ])("rejects unsafe %s values", (field, value) => {
    expect(() => parseEnv({ ...valid, [field]: value })).toThrow(new RegExp(field));
  });

  it("rejects missing required secrets", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/i);
  });

  it("requires an explicitly selected database path", () => {
    expect(() => parseEnv({ ...valid, DATABASE_PATH: undefined })).toThrow(/DATABASE_PATH/i);
  });
});
