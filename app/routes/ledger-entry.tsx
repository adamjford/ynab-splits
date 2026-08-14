import { Form, Link } from "react-router";
import type { Route } from "./+types/ledger-entry";
import { buildManualSplitTarget, verifyManualSplitReadback } from "~/domain/manual-split";
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
    const posting = db.prepare("select p.id, p.status, p.last_error from ynab_postings p join ynab_transaction_decisions d on d.id = p.decision_id where p.user_id = ? and d.ledger_entry_id = ? and p.posting_kind = 'source' order by p.created_at desc limit 1").get(user.id, entry.id) as { id: string; status: string; last_error: string | null } | undefined;
    return { user, entry, shares, posting, task: task ? { ...task, intendedTarget: JSON.parse(task.intended_target_json) } : null };
  } finally { db.close(); }
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    if (intent === "retry-source") {
      const posting = db.prepare("select p.id, p.status, p.intended_target_json, p.remote_transaction_id, d.plan_id, d.ynab_transaction_id, d.source_snapshot_json from ynab_postings p join ynab_transaction_decisions d on d.id = p.decision_id where p.id = ? and p.user_id = ? and p.posting_kind = 'source' and d.ledger_entry_id = ?").get(String(form.get("postingId") ?? ""), user.id, params.entryId) as { id: string; status: string; intended_target_json: string; remote_transaction_id: string | null; plan_id: string; ynab_transaction_id: string; source_snapshot_json: string | null } | undefined;
      if (!posting) return { error: "Source posting not found or not owned by this session." };
      if (posting.status === "succeeded") return { posted: true };
      if (posting.status === "skipped") return { error: "Skipped postings cannot be retried." };
      const snapshot = posting.source_snapshot_json ? JSON.parse(posting.source_snapshot_json) : null;
      if (!snapshot) return { error: "This source posting has no immutable review snapshot and cannot be retried safely." };
      const target = JSON.parse(posting.intended_target_json);
      const { gateway } = gatewayForUser(db, user.id);
      const { verifyReviewedSource, verifySourceUpdate } = await import("~/services/ynab-verification.server");
      try {
        const remote = await gateway.getTransaction(posting.plan_id, posting.ynab_transaction_id);
        const stale = verifyReviewedSource(snapshot, remote);
        const unexpectedStale = stale.filter((difference) => !difference.startsWith("category changed") && !difference.startsWith("approval changed"));
        const alreadyApplied = verifySourceUpdate(snapshot, remote, target);
        if (unexpectedStale.length > 0) {
          db.prepare("update ynab_postings set status = 'conflict', last_error = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(unexpectedStale.join("; "), JSON.stringify(remote), posting.id);
          return { error: `YNAB source changed; refresh before retrying (${unexpectedStale.join("; ")})` };
        }
        if (alreadyApplied.length === 0) {
          db.prepare("update ynab_postings set status = 'succeeded', remote_transaction_id = ?, remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(remote.id, JSON.stringify(remote), posting.id);
          return { posted: true, alreadyExists: true };
        }
        await gateway.updateTransaction(posting.plan_id, posting.ynab_transaction_id, target);
        const readback = await gateway.getTransaction(posting.plan_id, posting.ynab_transaction_id);
        const differences = verifySourceUpdate(snapshot, readback, target);
        if (differences.length > 0) {
          db.prepare("update ynab_postings set status = 'conflict', last_error = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(differences.join("; "), JSON.stringify(readback), posting.id);
          return { error: `YNAB source retry read-back mismatch (${differences.join("; ")})` };
        }
        db.prepare("update ynab_postings set status = 'succeeded', remote_transaction_id = ?, remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(readback.id, JSON.stringify(readback), posting.id);
        return { posted: true };
      } catch (error) {
        db.prepare("update ynab_postings set status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(error instanceof Error ? error.message : "YNAB source retry failed", posting.id);
        return { error: error instanceof Error ? error.message : "YNAB source retry failed" };
      }
    }
    const task = db.prepare(`select mt.id, mt.status, mt.intended_target_json, d.plan_id, d.ynab_transaction_id from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id join ledger_entries e on e.id = d.ledger_entry_id where mt.id = ? and d.user_id = ? and e.id = ?`).get(String(form.get("taskId") ?? ""), user.id, params.entryId) as { id: string; status: string; intended_target_json: string; plan_id: string; ynab_transaction_id: string } | undefined;
    if (!task) return { error: "Manual task not found or not owned by this session." };
    if (intent === "dismiss") { db.prepare("update manual_ynab_tasks set status = 'dismissed', updated_at = CURRENT_TIMESTAMP where id = ?").run(task.id); return { dismissed: true }; }
    const target = JSON.parse(task.intended_target_json) as { parentAmountMinor: number; accountId: string; date: string; payeeName?: string | null; approved: true; lines: Array<{ categoryId: string; amountMinor: number; payeeName?: string | null; memo?: string | null }> };
    if (intent === "save-manual") {
      if (task.status !== "action_needed") return { error: "Only an action-needed manual task can be edited." };
      const settings = db.prepare("select splitting_category_id from plan_settings where user_id = ?").get(user.id) as { splitting_category_id: string | null } | undefined;
      const splittingCategoryId = settings?.splitting_category_id;
      if (!splittingCategoryId) return { error: "Configure the Splitting category before editing this task." };
      const categoryIds = form.getAll("allocationCategoryId").map(String);
      const amounts = form.getAll("allocationAmountMinor").map((value) => Number(value));
      if (categoryIds.length === 0 || categoryIds.length !== amounts.length || categoryIds.some((categoryId) => !categoryId) || amounts.some((amount) => !Number.isInteger(amount))) return { error: "Enter an integer amount for every owner category." };
      const source = { id: task.ynab_transaction_id, date: target.date, amountMinor: target.parentAmountMinor, accountId: target.accountId, payeeName: target.payeeName, approved: true, subtransactions: target.lines.map((line) => ({ categoryId: line.categoryId, amountMinor: line.amountMinor, payeeName: line.payeeName, memo: line.memo })) };
      const ownerAllocations = categoryIds.map((categoryId, index) => ({ categoryId, amountMinor: amounts[index], payeeName: target.lines.find((line) => line.categoryId === categoryId)?.payeeName ?? null, memo: target.lines.find((line) => line.categoryId === categoryId)?.memo ?? null }));
      const ownerShareMinor = target.lines.slice(0, -1).reduce((sum, line) => sum + line.amountMinor, 0);
      const nextTarget = buildManualSplitTarget(source, ownerShareMinor, ownerAllocations, splittingCategoryId);
      db.prepare("update manual_ynab_tasks set intended_target_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(JSON.stringify(nextTarget), task.id);
      return { prepared: true };
    }
    if (intent !== "verify") return { error: "Unknown action" };
    const settings = db.prepare("select currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_decimal_digits: number };
    const { gateway } = gatewayForUser(db, user.id);
    const remote = await gateway.getTransaction(task.plan_id, task.ynab_transaction_id);
    const verification = verifyManualSplitReadback({ id: remote.id, date: remote.date, amountMinor: milliunitsToMinor(remote.amount, settings.currency_decimal_digits), accountId: remote.account_id, payeeName: remote.payee_name, approved: remote.approved, subtransactions: remote.subtransactions.map((line) => ({ categoryId: line.category_id, amountMinor: milliunitsToMinor(line.amount, settings.currency_decimal_digits), payeeName: line.payee_name, memo: line.memo })) }, target);
    if (!verification.matches) { db.prepare("update manual_ynab_tasks set last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(verification.differences.join("; "), task.id); return { error: `Verification mismatch: ${verification.differences.join("; ")}` }; }
    db.prepare("update manual_ynab_tasks set status = 'verified', remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(JSON.stringify(remote), task.id);
    return { verified: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Verification failed" }; } finally { db.close(); }
}
export default function LedgerEntry({ loaderData, actionData }: Route.ComponentProps) {
  const manualLines = loaderData.task ? (loaderData.task.intendedTarget.lines as Array<{ categoryId: string; amountMinor: number }>) : [];
  return <section className="max-w-2xl"><Link className="text-sm underline" to="/ledger">Back to ledger</Link><h1 className="mt-3 text-3xl font-semibold">{loaderData.entry.description}</h1><p className="mt-2 text-slate-600">{loaderData.entry.entry_date} · {(loaderData.entry.amount_minor / 100).toFixed(2)} · paid by {loaderData.entry.cash_member_key}</p><div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Shares</h2><ul className="mt-2 list-disc pl-5">{loaderData.shares.map((share) => <li key={share.member_key}>{share.member_key}: {(share.amount_minor / 100).toFixed(2)}</li>)}</ul></div>{loaderData.posting && <div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">YNAB source update</h2><p>{loaderData.posting.status}{loaderData.posting.last_error ? `: ${loaderData.posting.last_error}` : ""}</p>{(loaderData.posting.status === "failed" || loaderData.posting.status === "conflict") && <Form method="post" className="mt-3"><input type="hidden" name="postingId" value={loaderData.posting.id} /><button className="rounded border px-3 py-2" name="intent" value="retry-source" type="submit">Retry source update</button></Form>}</div>}{loaderData.task && <div className="mt-6 rounded border bg-white p-4"><h2 className="font-semibold">Manual YNAB steps</h2><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Open the exact YNAB transaction for {loaderData.entry.entry_date} and this payee.</li><li>Edit it; do not delete or recreate it.</li><li>Preserve per-line payees and memos, then set the listed categories and amounts.</li><li>Approve the transaction, return here, and press Verify.</li></ol><Form method="post" className="mt-3 space-y-2"><input type="hidden" name="taskId" value={loaderData.task.id} />{manualLines.slice(0, -1).map((line, index) => <div className="grid grid-cols-2 gap-2" key={`${line.categoryId}-${index}`}><input className="rounded border p-2" name="allocationCategoryId" defaultValue={line.categoryId} aria-label={`Owner category ${index + 1}`} /><input className="rounded border p-2" name="allocationAmountMinor" type="number" defaultValue={line.amountMinor} aria-label={`Owner amount ${index + 1}`} /></div>)}<button className="rounded border px-3 py-2" name="intent" value="save-manual" type="submit">Save allocation guidance</button></Form><pre className="mt-3 overflow-auto rounded bg-slate-100 p-3 text-xs">{JSON.stringify(loaderData.task.intendedTarget, null, 2)}</pre>{loaderData.task.last_error && <p role="alert" className="mt-3 text-red-700">{loaderData.task.last_error}</p>}<Form method="post" className="mt-4 flex gap-2"><input type="hidden" name="taskId" value={loaderData.task.id} /><button className="rounded bg-slate-900 px-3 py-2 text-white" name="intent" value="verify" type="submit">Verify</button><button className="rounded border px-3 py-2" name="intent" value="dismiss" type="submit">Dismiss</button></Form></div>}{actionData?.error && <p role="alert" className="mt-4 text-red-700">{actionData.error}</p>}</section>;
}
