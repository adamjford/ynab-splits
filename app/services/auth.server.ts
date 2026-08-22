import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "../db/database.server";
import { encryptSecret } from "./crypto.server";
import type { AppEnv } from "./env.server";
import type { YnabUser } from "./ynab.server";
import { YnabTransportError } from "./ynab.server";

const TOKEN_URL = "https://app.ynab.com/oauth/token";
const OAUTH_TIMEOUT_MS = 15_000;
const oauthTokenSchema = z.object({
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().min(1),
  expires_in: z.number().finite().int().positive(),
});

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function buildAuthorizationUrl(env: AppEnv, state: string, verifier: string): string {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://app.ynab.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: env.YNAB_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${env.APP_ORIGIN}/auth/ynab/callback`,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  env: AppEnv,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.YNAB_CLIENT_ID,
        client_secret: env.YNAB_CLIENT_SECRET,
        redirect_uri: `${env.APP_ORIGIN}/auth/ynab/callback`,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new YnabTransportError("timeout");
    throw new YnabTransportError("network");
  }
  try {
    if (response.status === 401) throw new YnabTransportError("unauthorized", 401);
    if (response.status === 429) throw new YnabTransportError("rate_limit", 429);
    if (!response.ok) throw new YnabTransportError("http", response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new YnabTransportError("malformed");
    }
    const parsed = oauthTokenSchema.safeParse(body);
    if (!parsed.success) throw new YnabTransportError("malformed");
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

export function persistConnection(
  db: AppDatabase,
  env: AppEnv,
  user: YnabUser,
  displayName: string,
  token: OAuthTokenResponse,
): string {
  const localUserId = randomUUID();
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const existing = db.prepare("select id from users where ynab_user_id = ?").get(user.id) as
      { id: string } | undefined;
    const userId = existing?.id ?? localUserId;
    db.prepare(
      `insert into users (id, ynab_user_id, display_name) values (?, ?, ?)
      on conflict(ynab_user_id) do nothing`,
    ).run(userId, user.id, displayName);
    const saved = db.prepare("select id from users where ynab_user_id = ?").get(user.id) as { id: string };
    db.prepare(
      `insert into oauth_connections
      (id, user_id, encrypted_access_token, encrypted_refresh_token, access_expires_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(user_id) do update set encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token, access_expires_at = excluded.access_expires_at,
      disconnected_at = null, updated_at = excluded.updated_at`,
    ).run(
      randomUUID(),
      saved.id,
      encryptSecret(token.access_token, env.TOKEN_ENCRYPTION_KEY),
      encryptSecret(token.refresh_token, env.TOKEN_ENCRYPTION_KEY),
      new Date(Date.now() + token.expires_in * 1000).toISOString(),
      now,
    );
    return saved.id;
  });
  return transaction();
}
