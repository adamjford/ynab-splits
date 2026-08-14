import { Form, Link } from "react-router";
import { useEffect, useRef } from "react";
import { ActionFeedback } from "~/components/ActionFeedback";
import { Button } from "~/components/Button";
import type { Route } from "./+types/settlement-new";
import { buildSettlementPreview } from "~/domain/settlement";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries } from "~/services/ledger-query.server";
import { secureData } from "~/services/response.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = loadEntries(db, user.householdId);
    return secureData({ user, earliest: entries[0]?.date ?? new Date().toISOString().slice(0, 10), today: new Date().toISOString().slice(0, 10), entries: entries.map((entry) => ({ id: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor })) });
  } finally { db.close(); }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return secureData({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    if (form.get("confirmPayment") !== "on") return secureData({ error: "Confirm that the real payment occurred before creating a settlement." });
    const start = String(form.get("startDate") ?? "").trim();
    const end = String(form.get("endDate") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return secureData({ error: "Choose a valid inclusive date range." });
    const entries = loadEntries(db, user.householdId, "e.entry_date between ? and ?", [start, end]);
    if (entries.length === 0) return secureData({ error: "No unsettled entries are in that inclusive date range." });
    const preview = buildSettlementPreview(user.memberKey, entries);
    const debtor = preview.netMinor < 0 ? user.memberKey : user.memberKey === "adam" ? "chelsea" : "adam";
    const creditor = debtor === "adam" ? "chelsea" : "adam";
    const id = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("insert into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status, acknowledged_payment_at) values (?, ?, ?, ?, ?, ?, ?, 'closed', CURRENT_TIMESTAMP)").run(id, user.householdId, start, end, preview.netMinor === 0 ? null : debtor, preview.netMinor === 0 ? null : creditor, Math.abs(preview.netMinor));
      const insertItem = db.prepare("insert into settlement_items (settlement_id, ledger_entry_id) values (?, ?)");
      for (const entry of entries) insertItem.run(id, entry.id);
    })();
    return secureData({ settlementId: id });
  } catch (error) { return secureData({ error: error instanceof Error ? error.message : "Settlement could not be created" }); } finally { db.close(); }
}

export default function SettlementNew({ loaderData, actionData }: Route.ComponentProps) {
  const result = actionData && typeof actionData === "object" ? actionData as { error?: unknown; settlementId?: unknown } : null;
  const actionError = typeof result?.error === "string" ? result.error : null;
  const settlementId = typeof result?.settlementId === "string" ? result.settlementId : null;
  const settlementLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!settlementId) return;
    const focusTimer = window.setTimeout(() => settlementLinkRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [actionData, settlementId]);
  return <section className="max-w-3xl"><h1 className="text-3xl font-semibold">Settle up</h1><p className="mt-2 text-slate-600">Select an inclusive date range. Every entry can be settled only once.</p><Form method="post" className="mt-6 space-y-4 rounded border bg-white p-4"><label>Start date<input className="mt-1 w-full rounded border p-2" type="date" name="startDate" defaultValue={loaderData.earliest} required /></label><label>End date<input className="mt-1 w-full rounded border p-2" type="date" name="endDate" defaultValue={loaderData.today} required /></label><label className="flex items-center gap-2"><input type="checkbox" name="confirmPayment" /> I confirm the real payment occurred.</label><ActionFeedback error={actionError} focusKey={actionData} /><Button variant="primary" type="submit">Create settlement</Button></Form>{settlementId ? <><ActionFeedback status="Settlement created." focusKey={actionData} /><Link ref={settlementLinkRef} className="mt-4 inline-block underline" to={`/settlements/${settlementId}`}>Open settlement</Link></> : <Link className="mt-4 inline-block underline" to="/ledger">Back to ledger</Link>}</section>;
}
