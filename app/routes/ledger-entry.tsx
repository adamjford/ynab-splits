import { Form, Link } from "react-router";
import type { Route } from "./+types/ledger-entry";
import { verifyManualSplitReadback } from "~/domain/manual-split";
import { milliunitsToMinor } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { gatewayForUser } from "~/services/ynab-user.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entry = db.prepare(`select e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description, e.source_transaction_id, e.source_plan_id, e.category_id from ledger_entries e where e.id = ? and e.household_id = ?`).get(params.entryId, user.householdId) as { id: string; kind: string; amount_minor: number; cash_member_key: string; entry_date: string; description: string; source_transaction_id: string | null; source_plan_id: string | null; category_id: string | null } | undefined;
    if (!entry) throw new Response("Ledger entry not found", { status: 404 });
    const shares = db.prepare("select member_key, amount_minor from ledger_shares where entry_id = ? order by member_key").all(entry.id) as Array<{ member_key: string; amount_minor: number }>;
    const task = db.prepare(`select mt.id, mt.status, mt.intended_target_json, mt.last_error from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id where d.user_id = ? and d.ledger_entry_id = ? order by mt.created_at desc limit 1`).get(user.id, entry.id) as { id: string; status: string; intended_target_json: string; last_error: string | null } | undefined;
    return { user, entry, shares, task: task ? { ...task, intendedTarget: JSON.parse(task.intended_target_json) } : null };
  } finally { db.close(); }
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const task = db.prepare(`select mt.id, mt.status, mt.intended_target_json, d.plan_id, d.ynab_transaction_id from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id join ledger_entries e on e.id = d.ledger_entry_id where mt.id = ? and d.user_id = ? and e.id = ?`).get(String(form.get("taskId") ?? ""), user.id, params.entryId) as { id: string; status: string; intended_target_json: string; plan_id: string; ynab_transaction_id: string } | undefined;
    if (!task) return { error: "Manual task not found or not owned by this session." };
    if (intent === "dismiss") { db.prepare("update manual_ynab_tasks set status = 'dismissed', updated_at = CURRENT_TIMESTAMP where id = ?").run(task.id); return { dismissed: true }; }
    if (intent !== "verify") return { error: "Unknown action" };
    const settings = db.prepare("select currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_decimal_digits: number };
    const { gateway } = gatewayForUser(db, user.id);
    const remote = await gateway.getTransaction(task.plan_id, task.ynab_transaction_id);
    const target = JSON.parse(task.intended_target_json) as { parentAmountMinor: number; accountId: string; date: string; payeeName?: string | null; approved: true; lines: Array<{ categoryId: string; amountMinor: number; payeeName?: string | null; memo?: string | null }> };
    const verification = verifyManualSplitReadback({ id: remote.id, date: remote.date, amountMinor: milliunitsToMinor(remote.amount, settings.currency_decimal_digits), accountId: remote.account_id, payeeName: remote.payee_name, approved: remote.approved, subtransactions: remote.subtransactions.map((line) => ({ categoryId: line.category_id, amountMinor: milliunitsToMinor(line.amount, settings.currency_decimal_digits), payeeName: line.payee_name, memo: line.memo })) }, target);
    if (!verification.matches) { db.prepare("update manual_ynab_tasks set last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(verification.differences.join("; "), task.id); return { error: `Verification mismatch: ${verification.differences.join("; ")}` }; }
    db.prepare("update manual_ynab_tasks set status = 'verified', remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(JSON.stringify(remote), task.id);
    return { verified: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Verification failed" }; } finally { db.close(); }
}

export default function LedgerEntry({ loaderData, actionData }: Route.ComponentProps) {
  return <section className="max-w-2xl"><Link className="text-sm underline" to="/ledger">Back to ledger</Link><h1 className="mt-3 text-3xl font-semibold">{loaderData.entry.description}</h1><p className="mt-2 text-slate-600">{loaderData.entry.entry_date} · {(loaderData.entry.amount_minor / 100).toFixed(2)} · paid by {loaderData.entry.cash_member_key}</p><div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Shares</h2><ul className="mt-2 list-disc pl-5">{loaderData.shares.map((share) => <li key={share.member_key}>{share.member_key}: {(share.amount_minor / 100).toFixed(2)}</li>)}</ul></div>{loaderData.task && <div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Manual YNAB steps</h2><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Open the exact YNAB transaction for {loaderData.entry.entry_date} and this payee.</li><li>Edit it; do not delete or recreate it.</li><li>Preserve per-line payees and memos, then set the listed categories and amounts.</li><li>Approve the transaction, return here, and press Verify.</li></ol><pre className="mt-3 overflow-auto rounded bg-slate-100 p-3 text-xs">{JSON.stringify(loaderData.task.intendedTarget, null, 2)}</pre>{loaderData.task.last_error && <p role="alert" className="mt-3 text-red-700">{loaderData.task.last_error}</p>}<Form method="post" className="mt-4 flex gap-2"><input type="hidden" name="taskId" value={loaderData.task.id} /><button className="rounded bg-slate-900 px-3 py-2 text-white" name="intent" value="verify" type="submit">Verify</button><button className="rounded border px-3 py-2" name="intent" value="dismiss" type="submit">Dismiss</button></Form></div>}{actionData?.error && <p role="alert" className="mt-4 text-red-700">{actionData.error}</p>}</section>;
}
