import { describe, expect, it } from "vitest";
import { parseEnv, type AppEnv } from "./env.server";
import {
  clearAuthCookie,
  clearOAuthCookie,
  createAuthCookie,
  createOAuthCookie,
  readAuthUserId,
  readOAuthCookie,
} from "./session.server";

const baseEnv = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "session-secret-that-is-at-least-32-bytes",
  TOKEN_ENCRYPTION_KEY: "abcdef0123456789abcdef0123456789",
  YNAB_CLIENT_ID: "client-id",
  YNAB_CLIENT_SECRET: "client-secret",
};

function env(overrides: Record<string, string> = {}): AppEnv {
  return parseEnv({ ...baseEnv, ...overrides });
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0];
}

describe("instance-namespaced session cookies", () => {
  it("preserves the default cookie names", () => {
    const appEnv = env();
    const cookie = createAuthCookie("user-1", appEnv);
    const oauth = createOAuthCookie(appEnv).cookie;

    expect(cookie).toMatch(/^ynab_splits_auth=/);
    expect(oauth).toMatch(/^ynab_splits_oauth=/);
    expect(clearAuthCookie(appEnv)).toMatch(/^ynab_splits_auth=/);
    expect(clearOAuthCookie(appEnv)).toMatch(/^ynab_splits_oauth=/);
    expect(readAuthUserId(cookiePair(cookie), appEnv)).toBe("user-1");
  });

  it("uses one prefix consistently for creation, reads, and clears", () => {
    const appEnv = env({ INSTANCE_ID: "worktree-2", COOKIE_PREFIX: "ynab_worktree_2" });
    const authCookie = createAuthCookie("user-2", appEnv);
    const oauthCookie = createOAuthCookie(appEnv);

    expect(authCookie).toMatch(/^ynab_worktree_2_auth=/);
    expect(oauthCookie.cookie).toMatch(/^ynab_worktree_2_oauth=/);
    expect(clearAuthCookie(appEnv)).toMatch(/^ynab_worktree_2_auth=/);
    expect(clearOAuthCookie(appEnv)).toMatch(/^ynab_worktree_2_oauth=/);
    expect(readAuthUserId(cookiePair(authCookie), appEnv)).toBe("user-2");
    expect(readOAuthCookie(cookiePair(oauthCookie.cookie), appEnv)).toMatchObject({
      state: oauthCookie.payload.state,
      verifier: oauthCookie.payload.verifier,
      expiresAt: oauthCookie.payload.expiresAt,
    });
  });

  it("does not read a cookie issued for another instance", () => {
    const first = env({ INSTANCE_ID: "first", COOKIE_PREFIX: "ynab_first" });
    const second = env({ INSTANCE_ID: "second", COOKIE_PREFIX: "ynab_second" });
    const authCookie = createAuthCookie("user-1", first);
    const oauthCookie = createOAuthCookie(first).cookie;

    expect(readAuthUserId(cookiePair(authCookie), second)).toBeNull();
    expect(readOAuthCookie(cookiePair(oauthCookie), second)).toBeNull();
  });
});
