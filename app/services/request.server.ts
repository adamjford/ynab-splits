import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDatabase, type AppDatabase } from "../db/database.server";
import { getEnv } from "./env.server";
import { readAuthUserId } from "./session.server";

export function database(): AppDatabase {
  const env = getEnv();
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  return createDatabase(env.DATABASE_PATH);
}

export function authenticatedUser(
  request: Request,
  db: AppDatabase,
): { id: string; displayName: string; householdId: string; memberKey: "adam" | "chelsea" } {
  const userId = readAuthUserId(request.headers.get("Cookie"), getEnv());
  if (!userId) throw new Response("Sign in required", { status: 401 });
  const row = db
    .prepare(
      `select u.id, u.display_name, m.household_id, m.member_key from users u join memberships m on m.user_id = u.id where u.id = ?`,
    )
    .get(userId) as
    { id: string; display_name: string; household_id: string; member_key: "adam" | "chelsea" } | undefined;
  if (!row) throw new Response("Complete household onboarding", { status: 409 });
  return { id: row.id, displayName: row.display_name, householdId: row.household_id, memberKey: row.member_key };
}
