import { Form, Link } from "react-router";
import { ActionFeedback } from "~/components/ActionFeedback";
import { Button } from "~/components/Button";
import type { Route } from "./+types/inbox";
import { secureData } from "~/services/response.server";
import { authenticatedUser, database } from "~/services/request.server";
import { getEnv } from "~/services/env.server";
import { gatewayForUser } from "~/services/ynab-user.server";
import { reviewToken, saveInboxDecision, saveNotSharedDecision } from "~/services/inbox-orchestration.server";
import type { YnabTransaction } from "~/services/ynab.server";

interface InboxTransaction extends YnabTransaction {
  reviewToken: string;
}

function settingsFor(db: ReturnType<typeof database>, userId: string) {
  return db
    .prepare("select plan_id, currency_decimal_digits, splitting_category_id from plan_settings where user_id = ?")
    .get(userId) as
    { plan_id: string; currency_decimal_digits: number; splitting_category_id: string | null } | undefined;
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settings = settingsFor(db, user.id);
    if (!settings)
      return secureData({
        user,
        error: "Select your YNAB plan in settings before reviewing transactions.",
        transactions: [] as InboxTransaction[],
      });
    const { gateway } = gatewayForUser(db, user.id);
    const sourceAccounts = new Set(
      (
        db.prepare("select account_id from source_accounts where user_id = ?").all(user.id) as Array<{
          account_id: string;
        }>
      ).map((row) => row.account_id),
    );
    const decisions = new Set(
      (
        db
          .prepare(
            "select ynab_transaction_id from ynab_transaction_decisions where user_id = ? and decision in ('shared', 'not_shared', 'dismissed')",
          )
          .all(user.id) as Array<{ ynab_transaction_id: string }>
      ).map((row) => row.ynab_transaction_id),
    );
    const transactions = (await gateway.getUnapprovedTransactions(settings.plan_id))
      .filter(
        (transaction) =>
          sourceAccounts.has(transaction.account_id) &&
          !transaction.deleted &&
          !transaction.transfer_account_id &&
          !decisions.has(transaction.id),
      )
      .map((transaction) => ({
        ...transaction,
        reviewToken: reviewToken(
          getEnv().SESSION_SECRET,
          user,
          {
            planId: settings.plan_id,
            currencyDecimalDigits: settings.currency_decimal_digits,
            splittingCategoryId: settings.splitting_category_id,
          },
          transaction,
        ),
      }));
    return secureData({ user, error: null, transactions });
  } catch (error) {
    if (error instanceof Response) throw error;
    return secureData({
      user: null,
      error: error instanceof Error ? error.message : "YNAB inbox unavailable",
      transactions: [] as InboxTransaction[],
    });
  } finally {
    db.close();
  }
}

function parseSplit(form: FormData) {
  const type = String(form.get("splitType") ?? "equal");
  if (type === "exact")
    return { type: "exact" as const, otherAmountMinor: Number(form.get("otherAmountMinor") ?? NaN) };
  if (type === "percentage")
    return { type: "percentage" as const, otherBasisPoints: Number(form.get("otherBasisPoints") ?? NaN) };
  if (type === "equal") return { type: "equal" as const };
  throw new Error("Choose a supported split type.");
}

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const transactionId = String(form.get("transactionId") ?? "");
    const token = String(form.get("reviewToken") ?? "");
    const decision = String(form.get("decision") ?? "shared");
    const settings = settingsFor(db, user.id);
    if (!settings) return secureData({ error: "Configure YNAB settings first." });
    if (!transactionId || !token) return secureData({ error: "Refresh the inbox before submitting this review." });
    if (decision !== "shared" && decision !== "not_shared") return secureData({ error: "Unsupported inbox decision." });
    const { gateway } = gatewayForUser(db, user.id);
    const transaction = await gateway.getTransaction(settings.plan_id, transactionId);
    if (decision === "not_shared") {
      saveNotSharedDecision(
        db,
        user,
        {
          planId: settings.plan_id,
          currencyDecimalDigits: settings.currency_decimal_digits,
          splittingCategoryId: settings.splitting_category_id,
        },
        transaction,
        token,
        getEnv().SESSION_SECRET,
      );
      return secureData({ saved: true });
    }
    const result = await saveInboxDecision({
      db,
      user,
      settings: {
        planId: settings.plan_id,
        currencyDecimalDigits: settings.currency_decimal_digits,
        splittingCategoryId: settings.splitting_category_id,
      },
      gateway,
      transaction,
      decision: "shared",
      split: parseSplit(form),
      updateYnab: form.get("updateYnab") === "on",
      categoryId: String(form.get("categoryId") ?? transaction.category_id ?? "") || null,
      reviewToken: token,
      reviewSecret: getEnv().SESSION_SECRET,
    });
    return secureData(result);
  } catch (error) {
    if (error instanceof Response) throw error;
    return secureData({ error: error instanceof Error ? error.message : "Transaction could not be saved" });
  } finally {
    db.close();
  }
}

export default function Inbox({ loaderData, actionData }: Route.ComponentProps) {
  const result =
    actionData && typeof actionData === "object" ? (actionData as { error?: unknown; saved?: unknown }) : null;
  const actionError = typeof result?.error === "string" ? result.error : null;
  const actionStatus = result?.saved === true ? "Transaction review saved." : null;
  if (loaderData.error)
    return (
      <section>
        <h1 className="text-3xl font-semibold">YNAB inbox</h1>
        <p className="mt-3 rounded border bg-white p-4" role="alert">
          {loaderData.error}
        </p>
        <Link className="mt-4 inline-block rounded bg-slate-900 px-4 py-2 text-white" to="/settings/ynab">
          Open settings
        </Link>
      </section>
    );
  return (
    <section>
      <h1 className="text-3xl font-semibold">Unapproved transactions</h1>
      <p className="mt-2 text-slate-600">
        Save the ledger record first. API updates are optional and never used for existing splits.
      </p>
      <ActionFeedback error={actionError} status={actionStatus} focusKey={actionData} />
      <div className="mt-6 space-y-4">
        {loaderData.transactions.length === 0 && (
          <p className="rounded border bg-white p-4">No unapproved transactions require review.</p>
        )}
        {loaderData.transactions.map((transaction) => (
          <article className="rounded border bg-white p-4" key={transaction.id}>
            <h2 className="font-semibold">{transaction.payee_name ?? "(no payee)"}</h2>
            <p className="text-sm text-slate-600">
              {transaction.date} · {transaction.account_name ?? transaction.id} · {transaction.amount}
            </p>
            <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="transactionId" value={transaction.id} />
              <input type="hidden" name="reviewToken" value={transaction.reviewToken} />
              <label>
                Split type
                <select className="mt-1 w-full rounded border p-2" name="splitType" defaultValue="equal">
                  <option value="equal">Equal</option>
                  <option value="percentage">Percentage</option>
                  <option value="exact">Exact</option>
                </select>
              </label>
              <label>
                Other share (minor units)
                <input className="mt-1 w-full rounded border p-2" name="otherAmountMinor" type="number" />
              </label>
              <label>
                Other share (basis points)
                <input
                  className="mt-1 w-full rounded border p-2"
                  name="otherBasisPoints"
                  type="number"
                  defaultValue="5000"
                />
              </label>
              <label>
                Actual category ID
                <input
                  className="mt-1 w-full rounded border p-2"
                  name="categoryId"
                  defaultValue={transaction.category_id ?? ""}
                />
              </label>
              <label className="flex items-center gap-2">
                <input name="updateYnab" type="checkbox" defaultChecked={loaderData.user?.memberKey === "adam"} />{" "}
                Update unsplit YNAB transaction
              </label>
              <div className="flex gap-2">
                <Button variant="primary" name="decision" value="shared" type="submit">
                  Save to ledger
                </Button>
                <Button variant="secondary" name="decision" value="not_shared" type="submit">
                  Not shared
                </Button>
              </div>
            </Form>
          </article>
        ))}
      </div>
    </section>
  );
}
