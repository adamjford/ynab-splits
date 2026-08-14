import { Form, Link } from "react-router";
import type { Route } from "./+types/ledger-entry";
import { formatMinorUnits, type CurrencyFormat } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { gatewayForUser } from "~/services/ynab-user.server";
import { secureData } from "~/services/response.server";
import { dismissManualTask, prepareManualTask, retrySourcePosting, verifyManualTask } from "~/services/inbox-orchestration.server";
export async function loader({ request, params }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entry = db.prepare(`
      select e.id, e.kind, e.amount_minor, e.cash_member_key, e.entry_date, e.description
      from ledger_entries e where e.id = ? and e.household_id = ? and e.voided_at is null
    `).get(params.entryId, user.householdId) as {
      id: string;
      kind: "expense" | "income";
      amount_minor: number;
      cash_member_key: "adam" | "chelsea";
      entry_date: string;
      description: string;
    } | undefined;
    if (!entry) throw new Response("Ledger entry not found", { status: 404 });
    const rows = db.prepare("select member_key, amount_minor from ledger_shares where entry_id = ? order by member_key").all(entry.id) as Array<{ member_key: "adam" | "chelsea"; amount_minor: number }>;
    const shares: { adam: number; chelsea: number } = { adam: 0, chelsea: 0 };
    for (const row of rows) shares[row.member_key] = row.amount_minor;
    if (rows.length !== 2 || new Set(rows.map((row) => row.member_key)).size !== 2 || rows.some((row) => !Number.isSafeInteger(row.amount_minor)) || shares.adam + shares.chelsea !== entry.amount_minor) {
      throw new Error(`ledger corruption: entry ${entry.id} has invalid shares`);
    }
    const task = db.prepare(`
      select mt.id, mt.status, mt.intended_target_json, mt.last_error
      from manual_ynab_tasks mt
      join ynab_transaction_decisions d on d.id = mt.decision_id
      where d.user_id = ? and d.ledger_entry_id = ?
      order by mt.created_at desc limit 1
    `).get(user.id, entry.id) as { id: string; status: string; intended_target_json: string; last_error: string | null } | undefined;
    const posting = db.prepare(`
      select p.id, p.status, p.last_error
      from ynab_postings p
      join ynab_transaction_decisions d on d.id = p.decision_id
      where p.user_id = ? and d.ledger_entry_id = ? and p.posting_kind = 'source'
      order by p.created_at desc limit 1
    `).get(user.id, entry.id) as { id: string; status: string; last_error: string | null } | undefined;
    const settings = db.prepare("select currency_iso_code, currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_iso_code: string; currency_decimal_digits: number } | undefined;
    let ownerTask: { id: string; status: string; intendedTarget: unknown; errorCode?: string } | null = null;
    if (task) {
      let intendedTarget: unknown = null;
      try { intendedTarget = JSON.parse(task.intended_target_json); } catch { /* stable owner-visible error below */ }
      ownerTask = { id: task.id, status: task.status, intendedTarget, ...(task.last_error ? { errorCode: "manual-task-needs-attention" } : {}) };
    }
    return secureData({
      entry: {
        id: entry.id,
        kind: entry.kind,
        amountMinor: entry.amount_minor,
        payerMemberKey: entry.cash_member_key,
        date: entry.entry_date,
        description: entry.description,
        shares,
      },
      currency: settings ? { isoCode: settings.currency_iso_code, decimalDigits: settings.currency_decimal_digits } satisfies CurrencyFormat : null,
      ownerPrivate: {
        posting: posting ? { id: posting.id, status: posting.status, ...(posting.last_error ? { errorCode: "source-posting-needs-attention" } : {}) } : null,
        task: ownerTask,
      },
    });
  } finally { db.close(); }
}

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const { gateway } = gatewayForUser(db, user.id);
    if (intent === "retry-source") {
      const result = await retrySourcePosting(db, user.id, String(form.get("postingId") ?? ""), gateway);
      return secureData(result.posted ? { posted: true, status: result.status } : { error: result.error ?? "Source retry failed.", status: result.status });
    }
    const taskId = String(form.get("taskId") ?? "");
    if (intent === "dismiss") {
      dismissManualTask(db, user.id, taskId);
      return secureData({ dismissed: true });
    }
    if (intent === "save-manual") {
      const settings = db.prepare("select splitting_category_id from plan_settings where user_id = ?").get(user.id) as { splitting_category_id: string | null } | undefined;
      prepareManualTask(db, user.id, taskId, settings?.splitting_category_id ?? null, form.getAll("allocationCategoryId").map(String), form.getAll("allocationAmountMinor").map((value) => Number(value)));
      return secureData({ prepared: true });
    }
    if (intent === "verify") {
      const settings = db.prepare("select currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_decimal_digits: number } | undefined;
      if (!settings) return secureData({ error: "Configure currency settings before verification." });
      const result = await verifyManualTask(db, user.id, taskId, gateway, settings.currency_decimal_digits);
      return secureData(result.verified ? { verified: true } : { error: result.error });
    }
    return secureData({ error: "Unknown action" });
  } catch {
    return secureData({ error: "Verification failed." });
  } finally { db.close(); }
}
function displayAmount(amountMinor: number, currency: CurrencyFormat | null): string {
  const formatted = formatMinorUnits(amountMinor, currency);
  return typeof formatted === "string" ? formatted : formatted.message;
}

function targetLines(target: unknown): Array<{ categoryId: string; amountMinor: number }> {
  if (!target || typeof target !== "object" || !("lines" in target) || !Array.isArray(target.lines)) return [];
  return target.lines.filter((line): line is { categoryId: string; amountMinor: number } => typeof line === "object" && line !== null && "categoryId" in line && typeof line.categoryId === "string" && "amountMinor" in line && typeof line.amountMinor === "number");
}

export default function LedgerEntry({ loaderData, actionData }: Route.ComponentProps) {
  const task = loaderData.ownerPrivate.task;
  const posting = loaderData.ownerPrivate.posting;
  const manualLines = targetLines(task?.intendedTarget);
  const actionError = actionData && typeof actionData === "object" && "error" in actionData && typeof actionData.error === "string" ? actionData.error : null;
  return <section className="max-w-2xl"><Link className="text-sm underline" to="/ledger">Back to ledger</Link><h1 className="mt-3 text-3xl font-semibold">{loaderData.entry.description}</h1><p className="mt-2 text-slate-600">{loaderData.entry.date} · {displayAmount(loaderData.entry.amountMinor, loaderData.currency)} · paid by {loaderData.entry.payerMemberKey}</p><div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Shares</h2><ul className="mt-2 list-disc pl-5"><li>adam: {displayAmount(loaderData.entry.shares.adam, loaderData.currency)}</li><li>chelsea: {displayAmount(loaderData.entry.shares.chelsea, loaderData.currency)}</li></ul></div>{posting && <div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">YNAB source update</h2><p>{posting.status}{posting.errorCode ? ": Source posting needs attention." : ""}</p>{(posting.status === "failed" || posting.status === "conflict") && <Form method="post" className="mt-3"><input type="hidden" name="postingId" value={posting.id} /><button className="rounded border px-3 py-2" name="intent" value="retry-source" type="submit">Retry source update</button></Form>}</div>}{task && <div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Manual YNAB steps</h2><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Open the exact YNAB transaction for {loaderData.entry.date} and this payee.</li><li>Edit it; do not delete or recreate it.</li><li>Preserve per-line payees and memos, then set the listed categories and amounts.</li><li>Approve the transaction, return here, and press Verify.</li></ol><Form method="post" className="mt-3 space-y-2"><input type="hidden" name="taskId" value={task.id} />{manualLines.slice(0, -1).map((line, index) => <div className="grid grid-cols-2 gap-2" key={`${line.categoryId}-${index}`}><input className="rounded border p-2" name="allocationCategoryId" defaultValue={line.categoryId} aria-label={`Owner category ${index + 1}`} /><input className="rounded border p-2" name="allocationAmountMinor" type="number" defaultValue={line.amountMinor} aria-label={`Owner amount ${index + 1}`} /></div>)}<button className="rounded border px-3 py-2" name="intent" value="save-manual" type="submit">Save allocation guidance</button></Form>{task.errorCode && <p role="alert" className="mt-3 text-red-700">Manual task needs attention.</p>}<Form method="post" className="mt-4 flex gap-2"><input type="hidden" name="taskId" value={task.id} /><button className="rounded bg-slate-900 px-3 py-2 text-white" name="intent" value="verify" type="submit">Verify</button><button className="rounded border px-3 py-2" name="intent" value="dismiss" type="submit">Dismiss</button></Form></div>}{actionError && <p role="alert" className="mt-4 text-red-700">{actionError}</p>}</section>;
}
