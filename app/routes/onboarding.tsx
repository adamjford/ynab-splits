import { Form } from "react-router";
import { Button } from "~/components/Button";
import { ActionFeedback } from "~/components/ActionFeedback";
import type { Route } from "./+types/onboarding";
import { createHash, randomUUID } from "node:crypto";
import { database } from "~/services/request.server";
import { getEnv } from "~/services/env.server";
import { clearAuthCookie, readAuthUserId } from "~/services/session.server";
import { secureData, secureRedirect } from "~/services/response.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = readAuthUserId(request.headers.get("Cookie"), getEnv());
  if (!userId) return secureRedirect("/auth/ynab/start");
  const form = await request.formData();
  const displayName = String(form.get("displayName") ?? "").trim();
  const queryInviteToken = new URL(request.url).searchParams.get("invite") ?? "";
  const inviteToken = queryInviteToken || String(form.get("inviteToken") ?? "").trim();
  if (!displayName) return secureData({ error: "Enter a ledger display name." });
  const db = database();
  try {
    const existingUser = db.prepare("select id from users where id = ?").get(userId);
    if (!existingUser) {
      return secureRedirect("/auth/ynab/start", { headers: { "Set-Cookie": clearAuthCookie(getEnv()) } });
    }
    const transaction = db.transaction(() => {
      db.prepare("update users set display_name = ? where id = ?").run(displayName, userId);
      const existing = db.prepare("select household_id from memberships where user_id = ?").get(userId) as
        { household_id: string } | undefined;
      if (existing) return;
      if (!inviteToken) {
        const householdId = randomUUID();
        db.prepare("insert into households (id, name) values (?, ?)").run(householdId, "Household");
        db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, 'adam')").run(
          householdId,
          userId,
        );
        return;
      }
      const tokenHash = createHash("sha256").update(inviteToken).digest("hex");
      const invite = db
        .prepare(
          "select id, household_id, invited_member_key from invites where token_hash = ? and consumed_at is null and expires_at > CURRENT_TIMESTAMP",
        )
        .get(tokenHash) as { id: string; household_id: string; invited_member_key: "adam" | "chelsea" } | undefined;
      if (!invite) throw new Error("invite is expired or invalid");
      if (
        (db.prepare("select count(*) as count from memberships where household_id = ?").get(invite.household_id) as {
          count: number;
        }) &&
        (
          db.prepare("select count(*) as count from memberships where household_id = ?").get(invite.household_id) as {
            count: number;
          }
        ).count >= 2
      )
        throw new Error("household already has two members");
      db.prepare("insert into memberships (household_id, user_id, member_key) values (?, ?, ?)").run(
        invite.household_id,
        userId,
        invite.invited_member_key,
      );
      db.prepare("update invites set consumed_at = CURRENT_TIMESTAMP where id = ?").run(invite.id);
    });
    transaction();
    return secureRedirect("/");
  } catch (error) {
    return secureData({ error: error instanceof Error ? error.message : "Onboarding failed" });
  } finally {
    db.close();
  }
}

export default function Onboarding({ actionData }: Route.ComponentProps) {
  const actionError =
    actionData && typeof actionData === "object" && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Set up your household</h1>
      <p className="mt-2 text-slate-600">Choose the name the other household member will see.</p>
      <Form method="post" className="mt-6 space-y-4">
        <label className="block">
          Ledger display name
          <input className="mt-1 w-full rounded border p-2" name="displayName" required />
        </label>
        <label className="block">
          Invite token (leave blank to create the household)
          <input className="mt-1 w-full rounded border p-2" name="inviteToken" />
        </label>
        <ActionFeedback error={actionError} focusKey={actionData} />
        <Button variant="primary" type="submit">
          Continue
        </Button>
      </Form>
    </main>
  );
}
