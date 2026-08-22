import { decryptSecret, encryptSecret } from "./crypto.server";
import { getEnv } from "./env.server";
import type { AppDatabase } from "../db/database.server";
import { HttpYnabGateway } from "./ynab.server";

export function gatewayForConnection(db: AppDatabase, userId: string): { gateway: HttpYnabGateway } {
  const row = db.prepare(`select encrypted_access_token, encrypted_refresh_token, access_expires_at from oauth_connections where user_id = ? and disconnected_at is null`).get(userId) as { encrypted_access_token: string; encrypted_refresh_token: string; access_expires_at: string } | undefined;
  if (!row) throw new Error("Connect YNAB before continuing");
  return { gateway: createGateway(db, userId, row) };
}

export function gatewayForUser(db: AppDatabase, userId: string): { gateway: HttpYnabGateway; planId: string; splittingCategoryId: string | null; settlementMode: "simple" | "detailed" } {
  const row = db.prepare(`select c.encrypted_access_token, c.encrypted_refresh_token, c.access_expires_at, p.plan_id, p.splitting_category_id, p.settlement_mode from oauth_connections c join plan_settings p on p.user_id = c.user_id where c.user_id = ? and c.disconnected_at is null`).get(userId) as { encrypted_access_token: string; encrypted_refresh_token: string; access_expires_at: string; plan_id: string; splitting_category_id: string | null; settlement_mode: "simple" | "detailed" } | undefined;
  if (!row) throw new Error("Connect YNAB and select a plan before continuing");
  return { gateway: createGateway(db, userId, row), planId: row.plan_id, splittingCategoryId: row.splitting_category_id, settlementMode: row.settlement_mode };
}

function createGateway(db: AppDatabase, userId: string, row: { encrypted_access_token: string; encrypted_refresh_token: string; access_expires_at: string }): HttpYnabGateway {
  const env = getEnv();
  return new HttpYnabGateway(decryptSecret(row.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY), decryptSecret(row.encrypted_refresh_token, env.TOKEN_ENCRYPTION_KEY), new Date(row.access_expires_at).getTime(), env.YNAB_CLIENT_ID, env.YNAB_CLIENT_SECRET, fetch, async (token) => {
    db.prepare("update oauth_connections set encrypted_access_token = ?, encrypted_refresh_token = ?, access_expires_at = ?, updated_at = CURRENT_TIMESTAMP where user_id = ?").run(encryptSecret(token.accessToken, env.TOKEN_ENCRYPTION_KEY), encryptSecret(token.refreshToken, env.TOKEN_ENCRYPTION_KEY), new Date(token.expiresAt).toISOString(), userId);
  }, async () => {
    db.prepare("update oauth_connections set disconnected_at = CURRENT_TIMESTAMP where user_id = ?").run(userId);
  }, env.YNAB_API_ORIGIN, env.YNAB_OAUTH_ORIGIN);
}
