import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Form, Link } from "react-router";
import { ActionFeedback } from "~/components/ActionFeedback";
import { Button } from "~/components/Button";
import type { Route } from "./+types/dashboard";
import { buildSettlementPreview } from "~/domain/settlement";
import { formatMinorUnits, type CurrencyFormat } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries } from "~/services/ledger-query.server";
import { secureData } from "~/services/response.server";

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const token = randomBytes(32).toString("base64url");
    db.prepare("insert into invites (id, household_id, token_hash, expires_at, invited_member_key) values (?, ?, ?, datetime('now', '+24 hours'), ?)").run(randomUUID(), user.householdId, createHash("sha256").update(token).digest("hex"), user.memberKey === "adam" ? "chelsea" : "adam");
    return secureData({ inviteUrl: `/invite/${token}` });
  } finally { db.close(); }
}

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = loadEntries(db, user.householdId);
    const preview = buildSettlementPreview(user.memberKey, entries);
    const settings = db.prepare("select currency_iso_code, currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_iso_code: string; currency_decimal_digits: number } | undefined;
    const postingCounts = db.prepare(`
      select status, count(*) as count from ynab_postings
      where user_id = ? and status in ('pending', 'failed', 'conflict')
      group by status
    `).all(user.id) as Array<{ status: "pending" | "failed" | "conflict"; count: number }>;
    const counts: Record<"pending" | "failed" | "conflict", number> = { pending: 0, failed: 0, conflict: 0 };
    for (const row of postingCounts) counts[row.status] = row.count;
    const manualTasks = (db.prepare(`
      select count(*) as count from manual_ynab_tasks mt
      join ynab_transaction_decisions d on d.id = mt.decision_id
      where d.user_id = ? and mt.status = 'action_needed'
    `).get(user.id) as { count: number }).count;
    const recentActivity = db.prepare(`
      select id, kind, amount_minor, cash_member_key, entry_date, description
      from ledger_entries e
      where household_id = ? and voided_at is null
        and not exists (
          select 1 from settlement_items active_item
          where active_item.ledger_entry_id = e.id and active_item.unlinked_at is null
        )
      order by entry_date desc, created_at desc, id desc
      limit 5
    `).all(user.householdId) as Array<{
      id: string;
      kind: "expense" | "income";
      amount_minor: number;
      cash_member_key: "adam" | "chelsea";
      entry_date: string;
      description: string;
    }>;
    return secureData({
      openCount: entries.length,
      netMinor: preview.netMinor,
      direction: preview.direction,
      currency: settings ? { isoCode: settings.currency_iso_code, decimalDigits: settings.currency_decimal_digits } satisfies CurrencyFormat : null,
      postingCounts: counts,
      manualTaskCount: manualTasks,
      recentActivity: recentActivity.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amountMinor: entry.amount_minor,
        payerMemberKey: entry.cash_member_key,
        date: entry.entry_date,
        description: entry.description,
      })),
    });
  } finally { db.close(); }
}

function displayAmount(amountMinor: number, currency: CurrencyFormat | null): string {
  const formatted = formatMinorUnits(amountMinor, currency);
  return typeof formatted === "string" ? formatted : formatted.message;
}

export default function Dashboard({ loaderData, actionData }: Route.ComponentProps) {
  const amount = displayAmount(Math.abs(loaderData.netMinor), loaderData.currency);
  const direction = loaderData.direction === "owed" ? "you are owed" : loaderData.direction === "owes" ? "you owe" : "settled";
  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold">Dashboard</h1><p className="mt-2 text-slate-600">{direction} {amount}</p></div><Link className="rounded bg-slate-900 px-4 py-2 text-white" to="/inbox">Review inbox</Link></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Open entries</p><p className="text-2xl font-semibold">{loaderData.openCount}</p></article>
      <article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Pending postings</p><p className="text-2xl font-semibold">{loaderData.postingCounts.pending}</p></article>
      <article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Failed/conflicted postings</p><p className="text-2xl font-semibold">{loaderData.postingCounts.failed + loaderData.postingCounts.conflict}</p></article>
      <article className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Manual YNAB tasks</p><p className="text-2xl font-semibold">{loaderData.manualTaskCount}</p></article>
    </div>
    <div className="mt-8 rounded border bg-white p-4"><h2 className="font-semibold">Recent activity</h2><ul className="mt-3 divide-y">{loaderData.recentActivity.map((entry) => <li className="flex items-center justify-between gap-4 py-2" key={entry.id}><Link className="underline" to={`/ledger/${entry.id}`}>{entry.description}</Link><span className="text-sm text-slate-600">{displayAmount(entry.amountMinor, loaderData.currency)}</span></li>)}</ul></div>
    <div className="mt-8 rounded border bg-white p-4"><h2 className="font-semibold">Invite the other member</h2><Form method="post" className="mt-3"><Button variant="secondary" name="intent" value="invite" type="submit">Create one-use invite</Button></Form><ActionFeedback status={actionData?.inviteUrl ? "Invitation created. Copy the invite URL for the other member." : null} focusKey={actionData} />{actionData?.inviteUrl && <p className="mt-3 break-all text-sm">Invite URL: {actionData.inviteUrl}</p>}</div>
  </section>;
}
