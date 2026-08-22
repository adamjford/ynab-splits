import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db/database.server";
import { decryptSecret } from "./crypto.server";
import { buildAuthorizationUrl, exchangeCode, persistConnection } from "./auth.server";
import type { AppEnv } from "./env.server";
import type { YnabUser } from "./ynab.server";

const env: AppEnv = {
  APP_ORIGIN: "https://splits.example.test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
  TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-123456",
  YNAB_CLIENT_ID: "test-client-id",
  YNAB_CLIENT_SECRET: "test-client-secret",
  YNAB_API_ORIGIN: "https://api.ynab.com/v1",
  YNAB_OAUTH_ORIGIN: "https://app.ynab.com",
  HOST: "127.0.0.1",
  PORT: 3000,
  INSTANCE_ID: "default",
  INSTANCE_LABEL: "",
  COOKIE_PREFIX: "ynab_splits",
};
const user: YnabUser = { id: "ynab-user-1" };

function tokenResponse(
  overrides: Partial<{ access_token: string; refresh_token: string; expires_in: number }> = {},
): Response {
  return new Response(
    JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, ...overrides }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("YNAB OAuth service", () => {
  it("builds an authorization URL with an S256 PKCE challenge", () => {
    const verifier = "pkce-verifier-value";
    const url = new URL(buildAuthorizationUrl(env, "state-1", verifier));

    expect(url.origin + url.pathname).toBe("https://app.ynab.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: env.YNAB_CLIENT_ID,
      response_type: "code",
      redirect_uri: `${env.APP_ORIGIN}/auth/ynab/callback`,
      state: "state-1",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
  });
  it("uses an injected OAuth origin for authorization and token exchange", async () => {
    const oauthEnv = { ...env, YNAB_OAUTH_ORIGIN: "http://fake-ynab.test:4401" };
    const authorization = new URL(buildAuthorizationUrl(oauthEnv, "state-1", "verifier-1"));
    expect(authorization.origin + authorization.pathname).toBe("http://fake-ynab.test:4401/oauth/authorize");

    let tokenUrl = "";
    const fetchImpl: typeof fetch = async (url) => {
      tokenUrl = String(url);
      return tokenResponse();
    };
    await exchangeCode(oauthEnv, "code-1", "verifier-1", fetchImpl);
    expect(tokenUrl).toBe("http://fake-ynab.test:4401/oauth/token");
  });

  it("exchanges an authorization code using the configured client and verifier", async () => {
    const requests: RequestInit[] = [];
    let requestUrl = "";
    const fetchImpl: typeof fetch = async (url, init) => {
      requestUrl = String(url);
      requests.push(init ?? {});
      return tokenResponse({ access_token: " access-token ", refresh_token: " refresh-token " });
    };

    await expect(exchangeCode(env, "code-1", "verifier-1", fetchImpl)).resolves.toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
    });
    expect(requests).toHaveLength(1);
    expect(requestUrl).toBe("https://app.ynab.com/oauth/token");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect([...new URLSearchParams(requests[0].body as string)]).toEqual([
      ...new URLSearchParams({
        client_id: env.YNAB_CLIENT_ID,
        client_secret: env.YNAB_CLIENT_SECRET,
        redirect_uri: `${env.APP_ORIGIN}/auth/ynab/callback`,
        grant_type: "authorization_code",
        code: "code-1",
        code_verifier: "verifier-1",
      }),
    ]);
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { name: "denial", response: new Response("denied", { status: 400 }), expected: { kind: "http", status: 400 } },
    {
      name: "unauthorized",
      response: new Response("unauthorized", { status: 401 }),
      expected: { kind: "unauthorized", status: 401 },
    },
    {
      name: "rate limit",
      response: new Response("slow down", { status: 429 }),
      expected: { kind: "rate_limit", status: 429 },
    },
    { name: "malformed JSON", response: new Response("not-json", { status: 200 }), expected: { kind: "malformed" } },
    { name: "malformed token", response: tokenResponse({ refresh_token: "" }), expected: { kind: "malformed" } },
  ])("keeps $name token exchange failures explicit", async ({ response, expected }) => {
    const fetchImpl: typeof fetch = async () => response;
    await expect(exchangeCode(env, "code-1", "verifier-1", fetchImpl)).rejects.toMatchObject(expected);
  });

  it("classifies network failures separately from an aborted timeout", async () => {
    await expect(
      exchangeCode(env, "code-1", "verifier-1", async () => {
        throw new Error("offline");
      }),
    ).rejects.toMatchObject({ kind: "network" });

    vi.useFakeTimers();
    try {
      const timeoutRequest = exchangeCode(
        env,
        "code-1",
        "verifier-1",
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
      const assertion = expect(timeoutRequest).rejects.toMatchObject({ kind: "timeout" });
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a local user and encrypted connection for a new YNAB identity", () => {
    const db = createDatabase(":memory:");
    const localUserId = persistConnection(db, env, user, "Pending", {
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });
    expect(localUserId).toEqual(expect.any(String));
    const saved = db
      .prepare(
        `
      select u.id, u.display_name, c.encrypted_access_token, c.encrypted_refresh_token
      from users u join oauth_connections c on c.user_id = u.id
      where u.ynab_user_id = ?
    `,
      )
      .get(user.id) as {
      id: string;
      display_name: string;
      encrypted_access_token: string;
      encrypted_refresh_token: string;
    };
    expect(saved).toMatchObject({ id: localUserId, display_name: "Pending" });
    expect(decryptSecret(saved.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY)).toBe("new-access");
    expect(decryptSecret(saved.encrypted_refresh_token, env.TOKEN_ENCRYPTION_KEY)).toBe("new-refresh");
    db.close();
  });

  it("encrypts tokens, upserts one connection, and clears a disconnection on reauthorization", () => {
    const db = createDatabase(":memory:");
    db.prepare("insert into users (id, ynab_user_id, display_name) values ('u1', ?, 'Old name')").run(user.id);

    const firstId = persistConnection(db, env, user, "First name", {
      access_token: "access-one",
      refresh_token: "refresh-one",
      expires_in: 3600,
    });
    const first = db.prepare("select * from oauth_connections where user_id = 'u1'").get() as {
      id: string;
      encrypted_access_token: string;
      encrypted_refresh_token: string;
      disconnected_at: string | null;
    };
    expect(firstId).toBe("u1");
    expect(first.id).toBeTruthy();
    expect(first.encrypted_access_token).not.toContain("access-one");
    expect(first.encrypted_refresh_token).not.toContain("refresh-one");
    expect(decryptSecret(first.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY)).toBe("access-one");
    expect(decryptSecret(first.encrypted_refresh_token, env.TOKEN_ENCRYPTION_KEY)).toBe("refresh-one");
    expect(first.disconnected_at).toBeNull();
    expect(db.prepare("select display_name from users where id = 'u1'").get()).toEqual({ display_name: "Old name" });

    db.prepare("update oauth_connections set disconnected_at = '2026-01-01T00:00:00.000Z' where user_id = 'u1'").run();
    const secondId = persistConnection(db, env, user, "Reauthorized name", {
      access_token: "access-two",
      refresh_token: "refresh-two",
      expires_in: 7200,
    });
    const second = db.prepare("select * from oauth_connections where user_id = 'u1'").get() as {
      id: string;
      encrypted_access_token: string;
      encrypted_refresh_token: string;
      disconnected_at: string | null;
    };
    expect(secondId).toBe("u1");
    expect(second.id).toBe(first.id);
    expect(db.prepare("select count(*) as count from oauth_connections where user_id = 'u1'").get()).toEqual({
      count: 1,
    });
    expect(db.prepare("select display_name from users where id = 'u1'").get()).toEqual({ display_name: "Old name" });
    expect(decryptSecret(second.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY)).toBe("access-two");
    expect(decryptSecret(second.encrypted_refresh_token, env.TOKEN_ENCRYPTION_KEY)).toBe("refresh-two");
    expect(second.disconnected_at).toBeNull();
    db.close();
  });
});
