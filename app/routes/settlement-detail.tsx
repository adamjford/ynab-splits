import { Form, Link } from "react-router";
import type { Route } from "./+types/settlement-detail";
import { buildSettlementTarget, settlementImportId } from "~/domain/settlement-posting";
import { minorToMilliunits } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries } from "~/services/ledger-query.server";
import { gatewayForUser } from "~/services/ynab-user.server";
import { secureData } from "~/services/response.server";
import { verifyCreatedPosting } from "~/services/ynab-verification.server";
import { YnabTransportError } from "~/services/ynab.server";
import { ActionFeedback } from "~/components/ActionFeedback";
import { Button } from "~/components/Button";
import type { AppDatabase } from "~/db/database.server";

type Posting = { id: string; status: "pending" | "succeeded" | "conflict" | "failed" | "skipped"; import_id: string; intended_target_json: string; remote_transaction_id: string | null };

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "YNAB posting failed";
}

function destinationMap(db: AppDatabase, userId: string): Map<string, string> {
  const rows = db.prepare("select source_category_id, destination_category_id from category_assignments where user_id = ?").all(userId) as Array<{ source_category_id: string; destination_category_id: string }>;
  return new Map(rows.map((row) => [row.source_category_id, row.destination_category_id]));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settlement = db.prepare("select id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status from settlements where id = ? and household_id = ?").get(params.settlementId, user.householdId) as { id: string; start_date: string; end_date: string; debtor_member_key: string | null; creditor_member_key: string | null; amount_minor: number; status: string } | undefined;
    if (!settlement) throw new Response("Settlement not found", { status: 404 });
    const entries = loadEntries(db, user.householdId, "si.settlement_id = ?", [settlement.id]);
    const mine = db.prepare("select id, status, import_id, intended_target_json, remote_transaction_id from ynab_postings where settlement_id = ? and user_id = ? and posting_kind = 'settlement'").get(settlement.id, user.id) as Posting | undefined;
    const other = db.prepare("select status from ynab_postings where settlement_id = ? and user_id != ? and posting_kind = 'settlement'").all(settlement.id, user.id) as Array<{ status: Posting["status"] }>;
    const otherStatus = other.length === 0 ? null : other.some((row) => row.status === "succeeded") ? "succeeded" : other.some((row) => row.status === "pending") ? "pending" : other.some((row) => row.status === "conflict") ? "conflict" : other.some((row) => row.status === "failed") ? "failed" : "skipped";
    return secureData({ user: { memberKey: user.memberKey }, settlement, entries: entries.map((entry) => ({ id: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor })), posting: mine ? { id: mine.id, status: mine.status, importId: mine.import_id } : null, otherStatus });
  } finally { db.close(); }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return secureData({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const settlement = db.prepare("select id, household_id, start_date, end_date, amount_minor, status from settlements where id = ? and household_id = ?").get(params.settlementId, user.householdId) as { id: string; household_id: string; start_date: string; end_date: string; amount_minor: number; status: "open" | "closed" | "voided" } | undefined;
    if (!settlement) return secureData({ error: "Settlement not found" }, 404);

    if (intent === "void") {
      if (form.get("confirmVoid") !== "on") return secureData({ error: "Confirm settlement voiding before continuing." });
      if (settlement.status === "voided") return secureData({ voided: true });
      const succeeded = Boolean(db.prepare("select 1 from ynab_postings where settlement_id = ? and status = 'succeeded' limit 1").get(settlement.id));
      if (succeeded && form.get("confirmRemoteCleanup") !== "on") return secureData({ error: "A succeeded YNAB copy exists. Confirm that remote cleanup is manual before voiding." });
      db.transaction(() => {
        db.prepare("update settlements set status = 'voided' where id = ?").run(settlement.id);
        db.prepare("update settlement_items set unlinked_at = CURRENT_TIMESTAMP where settlement_id = ? and unlinked_at is null").run(settlement.id);
        db.prepare("update ynab_postings set status = 'skipped', updated_at = CURRENT_TIMESTAMP where settlement_id = ? and status = 'failed'").run(settlement.id);
      })();
      return secureData({ voided: true });
    }

    if (intent === "restore") {
      const conflicts = db.prepare(`select si.ledger_entry_id from settlement_items si join ledger_entries e on e.id = si.ledger_entry_id where si.settlement_id = ? and (e.voided_at is not null or exists (select 1 from settlement_items other where other.ledger_entry_id = si.ledger_entry_id and other.unlinked_at is null and other.settlement_id != ?))`).all(settlement.id, settlement.id) as Array<{ ledger_entry_id: string }>;
      if (conflicts.length > 0) return secureData({ error: `Settlement cannot be restored because entries ${conflicts.map((row) => row.ledger_entry_id).join(", ")} changed or are already linked.` });
      try {
        db.transaction(() => {
          db.prepare("update settlement_items set unlinked_at = null where settlement_id = ?").run(settlement.id);
          db.prepare("update settlements set status = 'closed' where id = ?").run(settlement.id);
        })();
      } catch { return secureData({ error: "Settlement restore conflicted with another active settlement." }); }
      return secureData({ restored: true });
    }

    if (intent === "skip") {
      if (form.get("confirmSkip") !== "on") return secureData({ error: "Confirm skipping this optional YNAB copy." });
      const posting = db.prepare("select id, status from ynab_postings where id = ? and settlement_id = ? and user_id = ? and posting_kind = 'settlement'").get(String(form.get("postingId") ?? ""), settlement.id, user.id) as { id: string; status: Posting["status"] } | undefined;
      if (!posting) return secureData({ error: "Posting not found or not owned by this session." });
      if (posting.status === "succeeded") return secureData({ error: "Succeeded postings cannot be skipped." });
      db.prepare("update ynab_postings set status = 'skipped', last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(posting.id);
      return secureData({ skipped: true });
    }

    if (intent !== "addToYnab" && intent !== "retry") return secureData({ error: "Unknown settlement action" });
    if (settlement.status === "voided") return secureData({ error: "Voided settlements cannot be posted." });
    if (settlement.amount_minor === 0) return secureData({ posted: false, zeroNet: true });
    const settings = db.prepare("select plan_id, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode from plan_settings where user_id = ?").get(user.id) as { plan_id: string; currency_decimal_digits: number; settlement_account_id: string | null; splitting_category_id: string | null; settlement_mode: "simple" | "detailed" } | undefined;
    const accountId = settings?.settlement_account_id;
    const splittingCategoryId = settings?.splitting_category_id;
    if (!settings || !accountId || !splittingCategoryId) return secureData({ error: "Configure settlement account and Splitting category first." });
    let posting = (intent === "retry"
      ? db.prepare("select id, status, import_id, intended_target_json, remote_transaction_id from ynab_postings where id = ? and settlement_id = ? and user_id = ? and posting_kind = 'settlement'").get(String(form.get("postingId") ?? ""), settlement.id, user.id)
      : db.prepare("select id, status, import_id, intended_target_json, remote_transaction_id from ynab_postings where settlement_id = ? and user_id = ? and posting_kind = 'settlement'").get(settlement.id, user.id)) as Posting | undefined;
    if (intent === "addToYnab" && !posting) {
      const entries = loadEntries(db, user.householdId, "si.settlement_id = ?", [settlement.id]);
      const target = buildSettlementTarget(user.memberKey, entries, settings.settlement_mode, splittingCategoryId, destinationMap(db, user.id));
      const postingId = crypto.randomUUID();
      const importId = settlementImportId(postingId);
      const intended = { account_id: accountId, date: settlement.end_date, payee_name: target.payee, amount: minorToMilliunits(target.parentAmountMinor, settings.currency_decimal_digits), category_id: target.categoryId, approved: true, subtransactions: target.subtransactions.map((line) => ({ amount: minorToMilliunits(line.amountMinor, settings.currency_decimal_digits), category_id: line.categoryId, memo: line.memo })), import_id: importId };
      db.transaction(() => db.prepare("insert into ynab_postings (id, settlement_id, user_id, posting_kind, status, import_id, intended_target_json) values (?, ?, ?, 'settlement', 'pending', ?, ?)").run(postingId, settlement.id, user.id, importId, JSON.stringify(intended)))();
      posting = { id: postingId, status: "pending", import_id: importId, intended_target_json: JSON.stringify(intended), remote_transaction_id: null };
    }
    if (!posting) return secureData({ error: "Posting not found or not owned by this session." });
    if (posting.status === "succeeded") return secureData({ posted: true });
    if (posting.status === "skipped") return secureData({ error: "Skipped postings cannot be retried." });

    const intended = JSON.parse(posting.intended_target_json);
    const { gateway, planId } = gatewayForUser(db, user.id);
    try {
      const existing = await gateway.findTransactionByImportId(planId, posting.import_id) ?? (posting.remote_transaction_id ? await gateway.getTransaction(planId, posting.remote_transaction_id) : null);
      if (existing) {
        const differences = verifyCreatedPosting(intended, existing);
        if (differences.length > 0) {
          db.prepare("update ynab_postings set status = 'conflict', last_error = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(differences.join("; "), JSON.stringify(existing), posting.id);
          return secureData({ error: "YNAB posting does not match its reserved target; it needs review." });
        }
        db.prepare("update ynab_postings set status = 'succeeded', remote_transaction_id = ?, remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(existing.id, JSON.stringify(existing), posting.id);
        return secureData({ posted: true, alreadyExists: true });
      }
      const created = await gateway.createTransaction(planId, intended);
      const differences = verifyCreatedPosting(intended, created);
      if (differences.length > 0) {
        db.prepare("update ynab_postings set status = 'conflict', last_error = ?, remote_transaction_id = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(differences.join("; "), created.id, JSON.stringify(created), posting.id);
        return secureData({ error: "YNAB posting read-back mismatch; it needs review." });
      }
      db.prepare("update ynab_postings set status = 'succeeded', remote_transaction_id = ?, remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ?").run(created.id, JSON.stringify(created), posting.id);
      return secureData({ posted: true });
    } catch (error) {
      const indeterminate = error instanceof YnabTransportError && (error.kind === "timeout" || error.kind === "network");
      db.prepare("update ynab_postings set status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(indeterminate ? "pending" : "failed", indeterminate ? null : safeError(error), posting.id);
      return secureData({ error: indeterminate ? "YNAB did not confirm the request; retry safely to recover it." : safeError(error) });
    }
  } catch (error) { return secureData({ error: safeError(error) }); } finally { db.close(); }
}

export default function SettlementDetail({ loaderData, actionData }: Route.ComponentProps) {
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const actionStatus = actionData && "posted" in actionData && actionData.posted
    ? "Settlement copied to YNAB."
    : actionData && "restored" in actionData && actionData.restored
      ? "Settlement restored."
      : null;
  return <section><Link className="text-sm underline" to="/settlements/new">New settlement</Link><h1 className="mt-3 text-3xl font-semibold">Settlement</h1><p className="mt-2 text-slate-600">{loaderData.settlement.start_date} through {loaderData.settlement.end_date} · {loaderData.settlement.amount_minor} · {loaderData.settlement.status}</p><ul className="mt-6 rounded border bg-white p-4">{loaderData.entries.map((entry) => <li className="border-b py-2 last:border-0" key={entry.id}>{entry.date} · {entry.description} · {entry.amountMinor}</li>)}</ul>{loaderData.settlement.status === "voided" ? <Form method="post" className="mt-6"><Button variant="secondary" name="intent" value="restore" type="submit">Restore settlement</Button></Form> : loaderData.settlement.amount_minor > 0 && <Form method="post" className="mt-6"><Button variant="primary" name="intent" value="addToYnab" type="submit">Copy my settlement to YNAB</Button></Form>}<ActionFeedback error={actionError} status={actionStatus} focusKey={actionData} /></section>;
}
