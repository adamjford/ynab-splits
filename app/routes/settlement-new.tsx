import { Form, Link } from "react-router";
import type { Route } from "./+types/settlement-new";
import { buildSettlementPreview } from "~/domain/settlement";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries } from "~/services/ledger-query.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = loadEntries(db, user.householdId, "e.voided_at is null and si.ledger_entry_id is null", []);
    return { user, earliest: entries[0]?.date ?? new Date().toISOString().slice(0, 10), today: new Date().toISOString().slice(0, 10), entries: entries.map((entry) => ({ id: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor })) };
  } finally { db.close(); }
}

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    if (form.get("confirmPayment") !== "on") return { error: "Confirm that the real payment occurred before creating a settlement." };
    const start = String(form.get("startDate") ?? "");
    const end = String(form.get("endDate") ?? "");
    const entries = loadEntries(db, user.householdId, "e.voided_at is null and si.ledger_entry_id is null and e.entry_date between ? and ?", [start, end]);
    if (entries.length === 0) return { error: "No unsettled entries are in that inclusive date range." };
    const preview = buildSettlementPreview(user.memberKey, entries);
    const debtor = preview.netMinor < 0 ? user.memberKey : user.memberKey === "adam" ? "chelsea" : "adam";
    const creditor = debtor === "adam" ? "chelsea" : "adam";
    const id = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("insert into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at) values (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)").run(id, user.householdId, start, end, preview.netMinor === 0 ? null : debtor, preview.netMinor === 0 ? null : creditor, Math.abs(preview.netMinor), preview.netMinor === 0 ? "closed" : "open");
      const insertItem = db.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values (?, ?)");
      for (const entry of entries) insertItem.run(id, entry.id);
    })();
    return { settlementId: id };
  } catch (error) { return { error: error instanceof Error ? error.message : "Settlement could not be created" }; } finally { db.close(); }
}

export default function SettlementNew({ loaderData, actionData }: Route.ComponentProps) {
  return <section className="max-w-3xl"><h1 className="text-3xl font-semibold">Settle up</h1><p className="mt-2 text-slate-600">Select an inclusive date range. Every entry can be settled only once.</p><Form method="post" className="mt-6 space-y-4 rounded border bg-white p-4"><label>Start date<input className="mt-1 w-full rounded border p-2" type="date" name="startDate" defaultValue={loaderData.earliest} required /></label><label>End date<input className="mt-1 w-full rounded border p-2" type="date" name="endDate" defaultValue={loaderData.today} required /></label><label className="flex items-center gap-2"><input type="checkbox" name="confirmPayment" /> I confirm the real payment occurred.</label>{actionData?.error && <p role="alert" className="text-red-700">{actionData.error}</p>}<button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">Create settlement</button></Form><div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Available entries</h2><ul className="mt-2 space-y-1">{loaderData.entries.map((entry) => <li key={entry.id}>{entry.date} · {entry.description} · {(entry.amountMinor / 100).toFixed(2)}</li>)}</ul></div>{actionData?.settlementId && <p className="mt-4"><Link className="underline" to={`/settlements/${actionData.settlementId}`}>Open settlement</Link></p>}</section>;
}
