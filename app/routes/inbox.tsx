import { Form, Link } from "react-router";
import type { Route } from "./+types/inbox";
import { allocateShares } from "~/domain/ledger";
import { minorToMilliunits, milliunitsToMinor } from "~/domain/money";
import { buildManualSplitTarget } from "~/domain/manual-split";
import { authenticatedUser, database } from "~/services/request.server";
import { gatewayForUser } from "~/services/ynab-user.server";
interface InboxTransaction { id: string; date: string; amount: number; account_id: string; category_id: string | null; payee_name?: string | null; account_name?: string; category_name?: string | null; subtransactions: Array<{ category_id: string | null; amount: number; payee_name?: string | null; memo?: string | null }>; }

export async function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settings = db.prepare("select plan_id, currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { plan_id: string; currency_decimal_digits: number } | undefined;
    if (!settings) return { user, error: "Select your YNAB plan in settings before reviewing transactions.", transactions: [] as InboxTransaction[] };
    const { gateway } = gatewayForUser(db, user.id);
    const sourceAccounts = new Set((db.prepare("select account_id from source_accounts where user_id = ?").all(user.id) as Array<{ account_id: string }>).map((row) => row.account_id));
    const decisions = new Set((db.prepare("select ynab_transaction_id from ynab_transaction_decisions where user_id = ? and decision in ('shared', 'not_shared', 'dismissed')").all(user.id) as Array<{ ynab_transaction_id: string }>).map((row) => row.ynab_transaction_id));
    const transactions = (await gateway.getUnapprovedTransactions(settings.plan_id)).filter((transaction) => sourceAccounts.has(transaction.account_id) && !transaction.deleted && !transaction.transfer_account_id && !decisions.has(transaction.id));
    return { user, error: null, transactions };
  } catch (error) { return { user: null, error: error instanceof Error ? error.message : "YNAB inbox unavailable", transactions: [] as InboxTransaction[] }; } finally { db.close(); }
}

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const transactionId = String(form.get("transactionId") ?? "");
    const decision = String(form.get("decision") ?? "shared");
    const settings = db.prepare("select plan_id, currency_decimal_digits, splitting_category_id from plan_settings where user_id = ?").get(user.id) as { plan_id: string; currency_decimal_digits: number; splitting_category_id: string | null } | undefined;
    if (!settings) return { error: "Configure YNAB settings first." };
    if (!transactionId) return { error: "Select a transaction." };
    const { gateway } = gatewayForUser(db, user.id);
    const transaction = await gateway.getTransaction(settings.plan_id, transactionId);
    const parentMinor = milliunitsToMinor(transaction.amount, settings.currency_decimal_digits);
    const totalMinor = Math.abs(parentMinor);
    if (decision === "not_shared") {
      db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision) values (?, ?, ?, ?, ?)").run(crypto.randomUUID(), user.id, settings.plan_id, transaction.id, "not_shared");
      return { saved: true };
    }
    const input = form.get("splitType") === "exact" ? { type: "exact" as const, otherAmountMinor: Number(form.get("otherAmountMinor") ?? 0) } : form.get("splitType") === "percentage" ? { type: "percentage" as const, otherBasisPoints: Number(form.get("otherBasisPoints") ?? 5000) } : { type: "equal" as const };
    const shares = allocateShares(totalMinor, user.memberKey, user.memberKey === "adam" ? "chelsea" : "adam", input);
    const signedShares = shares.map((share) => ({ memberKey: share.memberId, amountMinor: share.amountMinor }));
    const entryId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id, source_plan_id, source_transaction_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(entryId, user.householdId, parentMinor < 0 ? "expense" : "income", totalMinor, user.memberKey, transaction.date, transaction.payee_name ?? "YNAB transaction", transaction.category_id, settings.plan_id, transaction.id);
      const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
      for (const share of signedShares) insertShare.run(entryId, share.memberKey, share.amountMinor);
      db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision, ledger_entry_id) values (?, ?, ?, ?, 'shared', ?)").run(crypto.randomUUID(), user.id, settings.plan_id, transaction.id, entryId);
    })();
    if (transaction.subtransactions.length > 0) {
      if (!settings.splitting_category_id) return { saved: true, error: "Ledger saved; configure the Splitting category to prepare manual YNAB steps." };
      const source = { id: transaction.id, date: transaction.date, amountMinor: parentMinor, accountId: transaction.account_id, payeeName: transaction.payee_name, approved: transaction.approved, subtransactions: transaction.subtransactions.map((line) => ({ categoryId: line.category_id, amountMinor: milliunitsToMinor(line.amount, settings.currency_decimal_digits), payeeName: line.payee_name, memo: line.memo })) };
      const ownerShareSigned = signedShares[0].amountMinor * (parentMinor < 0 ? -1 : 1);
      const allocations = source.subtransactions.filter((line) => line.categoryId && line.categoryId !== settings.splitting_category_id).map((line) => ({ categoryId: line.categoryId as string, amountMinor: line.amountMinor }));
      const target = buildManualSplitTarget(source, ownerShareSigned, allocations, settings.splitting_category_id);
      const decisionRow = db.prepare("select id from ynab_transaction_decisions where ledger_entry_id = ?").get(entryId) as { id: string };
      db.prepare("insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values (?, ?, 'action_needed', ?)").run(crypto.randomUUID(), decisionRow.id, JSON.stringify(target));
      return { saved: true, manualTask: true };
    }
    if (form.get("updateYnab") === "on") {
      const categoryId = String(form.get("categoryId") ?? transaction.category_id ?? "");
      if (!categoryId) return { saved: true, error: "Ledger saved; choose an actual YNAB category before updating." };
      const ownerMinor = signedShares[0].amountMinor * (parentMinor < 0 ? -1 : 1);
      const otherMinor = signedShares[1].amountMinor * (parentMinor < 0 ? -1 : 1);
    }
    return { saved: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Transaction could not be saved" }; } finally { db.close(); }
}

export default function Inbox({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.error) return <section><h1 className="text-3xl font-semibold">YNAB inbox</h1><p className="mt-3 rounded border bg-white p-4" role="alert">{loaderData.error}</p><Link className="mt-4 inline-block rounded bg-slate-900 px-4 py-2 text-white" to="/settings/ynab">Open settings</Link></section>;
  return <section><h1 className="text-3xl font-semibold">Unapproved transactions</h1><p className="mt-2 text-slate-600">Save the ledger record first. API updates are optional and never used for existing splits.</p>{actionData?.error && <p role="alert" className="mt-3 text-red-700">{actionData.error}</p>}<div className="mt-6 space-y-4">{loaderData.transactions.length === 0 && <p className="rounded border bg-white p-4">No unapproved transactions require review.</p>}{loaderData.transactions.map((transaction) => <article className="rounded border bg-white p-4" key={transaction.id}><h2 className="font-semibold">{transaction.payee_name ?? "(no payee)"}</h2><p className="text-sm text-slate-600">{transaction.date} · {transaction.account_name ?? transaction.id} · {transaction.amount}</p><Form method="post" className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="transactionId" value={transaction.id} /><label>Split type<select className="mt-1 w-full rounded border p-2" name="splitType" defaultValue="equal"><option value="equal">Equal</option><option value="percentage">Percentage</option><option value="exact">Exact</option></select></label><label>Other share (minor units)<input className="mt-1 w-full rounded border p-2" name="otherAmountMinor" type="number" /></label><label>Other share (basis points)<input className="mt-1 w-full rounded border p-2" name="otherBasisPoints" type="number" defaultValue="5000" /></label><label>Actual category ID<input className="mt-1 w-full rounded border p-2" name="categoryId" defaultValue={transaction.category_id ?? ""} /></label><label className="flex items-center gap-2"><input name="updateYnab" type="checkbox" /> Update unsplit YNAB transaction</label><div className="flex gap-2"><button className="rounded bg-slate-900 px-3 py-2 text-white" name="decision" value="shared" type="submit">Save to ledger</button><button className="rounded border px-3 py-2" name="decision" value="not_shared" type="submit">Not shared</button></div></Form></article>)}</div></section>;
}
