import { Form, Link } from "react-router";
import type { Route } from "./+types/settlement-detail";
import { buildSettlementTarget } from "~/domain/settlement-posting";
import { minorToMilliunits } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries } from "~/services/ledger-query.server";
import { gatewayForUser } from "~/services/ynab-user.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settlement = db.prepare("select id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status from settlements where id = ? and household_id = ?").get(params.settlementId, user.householdId) as { id: string; start_date: string; end_date: string; debtor_member_key: string | null; creditor_member_key: string | null; amount_minor: number; status: string } | undefined;
    if (!settlement) throw new Response("Settlement not found", { status: 404 });
    const entries = loadEntries(db, user.householdId, "si.settlement_id = ?", [settlement.id]);
    const postings = db.prepare("select user_id, status, import_id, last_error from ynab_postings where settlement_id = ?").all(settlement.id) as Array<{ user_id: string; status: string; import_id: string; last_error: string | null }>;
    return { user, settlement, entries: entries.map((entry) => ({ id: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor })), postings };
  } finally { db.close(); }
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    if (String(form.get("intent")) !== "addToYnab") return { error: "Unknown settlement action" };
    const settlement = db.prepare("select id, start_date, end_date, amount_minor from settlements where id = ? and household_id = ?").get(params.settlementId, user.householdId) as { id: string; start_date: string; end_date: string; amount_minor: number } | undefined;
    if (!settlement) return { error: "Settlement not found" };
    if (settlement.amount_minor === 0) return { error: "Zero-net settlements close locally and create no YNAB transaction." };
    const settings = db.prepare("select plan_id, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode from plan_settings where user_id = ?").get(user.id) as { plan_id: string; currency_decimal_digits: number; settlement_account_id: string | null; splitting_category_id: string | null; settlement_mode: "simple" | "detailed" } | undefined;
    if (!settings?.settlement_account_id || !settings.splitting_category_id) return { error: "Configure settlement account and Splitting category first." };
    const entries = loadEntries(db, user.householdId, "si.settlement_id = ?", [settlement.id]);
    const target = buildSettlementTarget(user.memberKey, entries, settings.settlement_mode, settings.splitting_category_id);
    const postingId = crypto.randomUUID();
    const importId = `YS:${Buffer.from(postingId.replaceAll("-", ""), "hex").toString("base64url").slice(0, 33)}`;
    const intended = { account_id: settings.settlement_account_id, date: settlement.end_date, payee_name: target.payee, amount: minorToMilliunits(target.parentAmountMinor, settings.currency_decimal_digits), category_id: target.categoryId, subtransactions: target.subtransactions.map((line) => ({ amount: minorToMilliunits(line.amountMinor, settings.currency_decimal_digits), category_id: line.categoryId, memo: line.memo })), import_id: importId };
    db.prepare("insert into ynab_postings (id, settlement_id, user_id, status, import_id, intended_target_json) values (?, ?, ?, 'pending', ?, ?)").run(postingId, settlement.id, user.id, importId, JSON.stringify(intended));
    try {
      const { gateway, planId } = gatewayForUser(db, user.id);
      const created = await gateway.createTransaction(planId, intended);
      db.prepare("update ynab_postings set status = 'succeeded', remote_transaction_id = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(created.id, JSON.stringify(created), postingId);
      return { posted: true };
    } catch (error) {
      db.prepare("update ynab_postings set status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(error instanceof Error ? error.message : "YNAB posting failed", postingId);
      return { error: error instanceof Error ? error.message : "YNAB posting failed" };
    }
  } catch (error) { return { error: error instanceof Error ? error.message : "Settlement action failed" }; } finally { db.close(); }
}

export default function SettlementDetail({ loaderData, actionData }: Route.ComponentProps) {
  return <section><Link className="text-sm underline" to="/settlements/new">New settlement</Link><h1 className="mt-3 text-3xl font-semibold">Settlement</h1><p className="mt-2 text-slate-600">{loaderData.settlement.start_date} through {loaderData.settlement.end_date} · {(loaderData.settlement.amount_minor / 100).toFixed(2)} · {loaderData.settlement.status}</p><ul className="mt-6 rounded border bg-white p-4">{loaderData.entries.map((entry) => <li className="border-b py-2 last:border-0" key={entry.id}>{entry.date} · {entry.description} · {(entry.amountMinor / 100).toFixed(2)}</li>)}</ul>{loaderData.settlement.amount_minor > 0 && <Form method="post" className="mt-6"><button className="rounded bg-slate-900 px-4 py-2 text-white" name="intent" value="addToYnab" type="submit">Add my copy to YNAB</button></Form>}{actionData?.error && <p role="alert" className="mt-3 text-red-700">{actionData.error}</p>}<h2 className="mt-8 font-semibold">My posting history</h2><ul className="mt-2">{loaderData.postings.filter((posting) => posting.user_id === loaderData.user.id).map((posting) => <li key={posting.import_id}>{posting.status}{posting.last_error ? `: ${posting.last_error}` : ""}</li>)}</ul></section>;
}
