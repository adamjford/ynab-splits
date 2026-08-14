import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Form, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { database, authenticatedUser } from "~/services/request.server";

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const token = randomBytes(32).toString("base64url");
    db.prepare("insert into invites (id, household_id, token_hash, expires_at, invited_member_key) values (?, ?, ?, datetime('now', '+24 hours'), ?)").run(randomUUID(), user.householdId, createHash("sha256").update(token).digest("hex"), user.memberKey === "adam" ? "chelsea" : "adam");
    return { inviteUrl: `/invite/${token}` };
  } finally { db.close(); }
}

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = db.prepare(`select e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description, s.member_key, s.amount_minor as share_minor from ledger_entries e join ledger_shares s on s.entry_id = e.id where e.household_id = ? and e.voided_at is null`).all(user.householdId) as Array<{ id: string; kind: "expense" | "income"; amount_minor: number; cash_member_key: "adam" | "chelsea"; entry_date: string; description: string; member_key: "adam" | "chelsea"; share_minor: number }>;
    const byEntry = new Map<string, { base: typeof entries[number]; shares: Partial<Record<"adam" | "chelsea", number>> }>();
    for (const row of entries) { const item = byEntry.get(row.id) ?? { base: row, shares: {} }; item.shares[row.member_key] = row.share_minor; byEntry.set(row.id, item); }
    let netMinor = 0;
    for (const { base, shares } of byEntry.values()) { const other = base.cash_member_key === "adam" ? (shares.chelsea ?? 0) : (shares.adam ?? 0); const own = base.cash_member_key === "adam" ? (shares.adam ?? 0) : (shares.chelsea ?? 0); const debt = base.kind === "expense" ? user.memberKey === base.cash_member_key ? -other : own : user.memberKey === base.cash_member_key ? other : -own; netMinor -= debt; }
    return { user, netMinor, openCount: byEntry.size, failedPostings: (db.prepare("select count(*) as count from ynab_postings where user_id = ? and status in ('failed', 'conflict')").get(user.id) as { count: number }).count, pendingManualTasks: (db.prepare("select count(*) as count from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id where d.user_id = ? and mt.status = 'action_needed'").get(user.id) as { count: number }).count };
  } finally { db.close(); }
}

export default function Dashboard({ loaderData, actionData }: Route.ComponentProps) {
  const direction = loaderData.netMinor > 0 ? "you are owed" : loaderData.netMinor < 0 ? "you owe" : "settled";
  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold">Dashboard</h1><p className="mt-2 text-slate-600">{direction} {(Math.abs(loaderData.netMinor) / 100).toFixed(2)}</p></div><Link className="rounded bg-slate-900 px-4 py-2 text-white" to="/inbox">Review inbox</Link></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-3"><article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Open entries</p><p className="text-2xl font-semibold">{loaderData.openCount}</p></article><article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Failed/conflicted postings</p><p className="text-2xl font-semibold">{loaderData.failedPostings}</p></article><article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Manual YNAB tasks</p><p className="text-2xl font-semibold">{loaderData.pendingManualTasks}</p></article></div>
    <div className="mt-8 rounded border bg-white p-4"><h2 className="font-semibold">Invite the other member</h2><Form method="post" className="mt-3"><button className="rounded border px-3 py-2" name="intent" value="invite" type="submit">Create one-use invite</button></Form>{actionData?.inviteUrl && <p className="mt-3 break-all text-sm">Invite URL: {actionData.inviteUrl}</p>}</div>
  </section>;
}
