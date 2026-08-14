import { decryptSecret, encryptSecret } from "./crypto.server";
import { getEnv } from "./env.server";
import type { AppDatabase } from "../db/database.server";
import { HttpYnabGateway } from "./ynab.server";

export function gatewayForUser(db: AppDatabase, userId: string): { gateway: HttpYnabGateway; planId: string; splittingCategoryId: string | null; settlementMode: "simple" | "detailed" } {
  const row = db.prepare(`select c.encrypted_access_token, c.encrypted_refresh_token, c.access_expires_at, p.plan_id, p.splitting_category_id, p.settlement_mode from oauth_connections c join plan_settings p on p.user_id = c.user_id where c.user_id = ?`).get(userId) as { encrypted_access_token: string; encrypted_refresh_token: string; access_expires_at: string; plan_id: string; splitting_category_id: string | null; settlement_mode: "simple" | "detailed" } | undefined;
  if (!row) throw new Error("Connect YNAB and select a plan before continuing");
  const env = getEnv();
  const gateway = new HttpYnabGateway(decryptSecret(row.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY), decryptSecret(row.encrypted_refresh_token, env.TOKEN_ENCRYPTION_KEY), new Date(row.access_expires_at).getTime(), env.YNAB_CLIENT_ID, env.YNAB_CLIENT_SECRET, fetch, async (token) => {
    db.prepare("update oauth_connections set encrypted_access_token = ?, encrypted_refresh_token = ?, access_expires_at = ?, updated_at = CURRENT_TIMESTAMP where user_id = ?").run(encryptSecret(token.accessToken, env.TOKEN_ENCRYPTION_KEY), encryptSecret(token.refreshToken, env.TOKEN_ENCRYPTION_KEY), new Date(token.expiresAt).toISOString(), userId);
  });
  return { gateway, planId: row.plan_id, splittingCategoryId: row.splitting_category_id, settlementMode: row.settlement_mode };
}
