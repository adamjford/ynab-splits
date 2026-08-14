import { Link } from "react-router";
import type { Route } from "./+types/ledger";
import { authenticatedUser, database } from "~/services/request.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = db.prepare(`select e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description, e.source_transaction_id, e.source_plan_id, s.member_key, s.amount_minor as share_minor from ledger_entries e join ledger_shares s on s.entry_id = e.id where e.household_id = ? and e.voided_at is null order by e.entry_date desc, e.created_at desc`).all(user.householdId) as Array<{ id: string; kind: string; amount_minor: number; cash_member_key: string; entry_date: string; description: string; source_transaction_id: string | null; source_plan_id: string | null; member_key: string; share_minor: number }>;
    const grouped = new Map<string, { id: string; kind: string; amountMinor: number; cashMemberKey: string; date: string; description: string; shares: Record<string, number>; ownerSourceId?: string }>();
    for (const row of entries) { const item = grouped.get(row.id) ?? { id: row.id, kind: row.kind, amountMinor: row.amount_minor, cashMemberKey: row.cash_member_key, date: row.entry_date, description: row.description, shares: {}, ownerSourceId: user.id && row.source_transaction_id && row.source_plan_id ? row.source_transaction_id : undefined }; item.shares[row.member_key] = row.share_minor; grouped.set(row.id, item); }
    return { user, entries: [...grouped.values()] };
  } finally { db.close(); }
}

export default function Ledger({ loaderData }: Route.ComponentProps) {
  return <section><h1 className="text-3xl font-semibold">Shared ledger</h1><p className="mt-2 text-slate-600">Both members see the same ledger. YNAB identifiers and manual controls remain private to the owning member.</p><div className="mt-6 overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3">Amount</th><th className="p-3">Paid by</th><th className="p-3">Shares</th></tr></thead><tbody>{loaderData.entries.map((entry) => <tr className="border-b last:border-0" key={entry.id}><td className="p-3">{entry.date}</td><td className="p-3"><Link className="underline" to={`/ledger/${entry.id}`}>{entry.description}</Link></td><td className="p-3">{(entry.amountMinor / 100).toFixed(2)}</td><td className="p-3">{entry.cashMemberKey}</td><td className="p-3">Adam {(entry.shares.adam ?? 0) / 100} · Chelsea {(entry.shares.chelsea ?? 0) / 100}</td></tr>)}</tbody></table>{loaderData.entries.length === 0 && <p className="p-4">No ledger entries yet.</p>}</div></section>;
}
