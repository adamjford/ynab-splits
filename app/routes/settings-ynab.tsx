import { Form } from "react-router";
import type { Route } from "./+types/settings-ynab";
import { database, authenticatedUser } from "~/services/request.server";
import { disconnectYnab, savePlanSettings, validatePlanSelections } from "~/services/settings.server";
import { gatewayForConnection, gatewayForUser } from "~/services/ynab-user.server";
import { clearAuthCookie } from "~/services/session.server";
import { getEnv } from "~/services/env.server";
import { secureData, secureRedirect } from "~/services/response.server";

type SettingsRow = {
  plan_id: string;
  currency_iso_code: string;
  currency_decimal_digits: number;
  settlement_account_id: string | null;
  splitting_category_id: string | null;
  settlement_mode: "simple" | "detailed";
};

export async function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settings = db.prepare("select plan_id, currency_iso_code, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode from plan_settings where user_id = ?").get(user.id) as SettingsRow | undefined;
    const accounts = db.prepare("select account_id from source_accounts where user_id = ? order by account_id").all(user.id) as Array<{ account_id: string }>;
    const sourceCategories = db.prepare("select category_id as id, category_id as name from ledger_entries where household_id = ? and category_id is not null group by category_id order by category_id").all(user.householdId);
    const mappings = (db.prepare("select source_category_id, source_category_name, destination_category_id, destination_category_name from category_assignments where user_id = ? order by source_category_name, source_category_id").all(user.id) as Array<{ source_category_id: string; source_category_name: string; destination_category_id: string; destination_category_name: string }>).map((row) => ({ sourceCategoryId: row.source_category_id, sourceCategoryName: row.source_category_name, destinationCategoryId: row.destination_category_id, destinationCategoryName: row.destination_category_name }));
    let plans: unknown[] = [];
    let destinationAccounts: unknown[] = [];
    let destinationCategories: unknown[] = [];
    if (settings) {
      try {
        const { gateway } = gatewayForUser(db, user.id);
        [plans, destinationAccounts, destinationCategories] = await Promise.all([
          gateway.getPlans(),
          gateway.getAccounts(settings.plan_id),
          gateway.getCategories(settings.plan_id),
        ]);
      } catch {
        // A disconnected/temporarily unavailable YNAB connection must not make
        // private local settings inaccessible.
      }
    }
    return secureData({
      settings: settings ?? null,
      accounts: accounts.map((account) => account.account_id),
      sourceCategories,
      mappings,
      plans,
      destinationAccounts,
      destinationCategories,
    });
  } finally { db.close(); }
}

function parseMappings(form: FormData): Array<{ sourceCategoryId: string; sourceCategoryName: string; destinationCategoryId: string; destinationCategoryName: string }> {
  const raw = String(form.get("categoryMappings") ?? "").trim();
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("category mappings must be a list");
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid category mapping");
    const row = item as Record<string, unknown>;
    return {
      sourceCategoryId: String(row.sourceCategoryId ?? "").trim(),
      sourceCategoryName: String(row.sourceCategoryName ?? "").trim(),
      destinationCategoryId: String(row.destinationCategoryId ?? "").trim(),
      destinationCategoryName: String(row.destinationCategoryName ?? "").trim(),
    };
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return secureData({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "save");
    if (intent === "disconnect") {
      disconnectYnab(db, user.id);
      return secureRedirect("/auth/ynab/start", { headers: { "Set-Cookie": clearAuthCookie(getEnv()) } });
    }
    const planId = String(form.get("planId") ?? "").trim() || "default";
    const currencyIsoCode = String(form.get("currencyIsoCode") ?? "").trim().toUpperCase();
    const currencyDecimalDigits = Number(form.get("currencyDecimalDigits") ?? 2);
    const settlementMode = String(form.get("settlementMode") ?? "simple");
    if (!currencyIsoCode || !["simple", "detailed"].includes(settlementMode)) return secureData({ error: "Plan, currency, and settlement mode are required." });
    const accountIds = form.getAll("sourceAccountId").flatMap((value) => String(value).split(/\r?\n/)).map((value) => value.trim()).filter(Boolean);
    const categoryAssignments = parseMappings(form);
    const { gateway } = gatewayForConnection(db, user.id);
    const [plans, planAccounts, planCategories] = await Promise.all([
      gateway.getPlans(),
      gateway.getAccounts(planId),
      gateway.getCategories(planId),
    ]);
    validatePlanSelections({
      planId,
      currencyIsoCode,
      currencyDecimalDigits,
      settlementMode: settlementMode as "simple" | "detailed",
      settlementAccountId: String(form.get("settlementAccountId") ?? "").trim() || undefined,
      splittingCategoryId: String(form.get("splittingCategoryId") ?? "").trim() || undefined,
      sourceAccountIds: accountIds,
      categoryAssignments,
    }, {
      planIds: new Set(["default", ...plans.map((plan) => plan.id)]),
      accountIds: new Set(planAccounts.filter((account) => !account.deleted).map((account) => account.id)),
      categoryIds: new Set(planCategories.filter((category) => !category.deleted).map((category) => category.id)),
    });
    savePlanSettings(db, user.id, {
      planId,
      currencyIsoCode,
      currencyDecimalDigits,
      settlementMode: settlementMode as "simple" | "detailed",
      settlementAccountId: String(form.get("settlementAccountId") ?? "").trim() || undefined,
      splittingCategoryId: String(form.get("splittingCategoryId") ?? "").trim() || undefined,
      sourceAccountIds: accountIds,
      categoryAssignments,
    });
    return secureData({ saved: true });
  } catch (error) {
    return secureData({ error: error instanceof Error ? error.message : "Settings could not be saved" });
  } finally { db.close(); }
}
export default function SettingsYnab({ loaderData, actionData }: Route.ComponentProps) {
  const accounts = loaderData.accounts ?? [];
  const mappings = loaderData.mappings ?? [];
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const saved = actionData && "saved" in actionData ? actionData.saved : false;
  return <section className="max-w-2xl"><h1 className="text-3xl font-semibold">YNAB settings</h1><p className="mt-2 text-slate-600">Use <code>default</code> to target the plan selected by your YNAB OAuth application, or enter a specific plan ID. These settings are private to your account.</p><Form method="post" className="mt-6 space-y-4 rounded border bg-white p-4"><label className="block">Plan ID<input className="mt-1 w-full rounded border p-2" name="planId" defaultValue={loaderData.settings?.plan_id ?? "default"} required /></label><label className="block">Currency ISO code<input className="mt-1 w-full rounded border p-2" name="currencyIsoCode" defaultValue={loaderData.settings?.currency_iso_code ?? "USD"} required /></label><label className="block">Currency decimal digits<input className="mt-1 w-full rounded border p-2" type="number" min="0" max="3" name="currencyDecimalDigits" defaultValue={loaderData.settings?.currency_decimal_digits ?? 2} required /></label><label className="block">Settlement account ID<input className="mt-1 w-full rounded border p-2" name="settlementAccountId" defaultValue={loaderData.settings?.settlement_account_id ?? ""} /></label><label className="block">Splitting category ID<input className="mt-1 w-full rounded border p-2" name="splittingCategoryId" defaultValue={loaderData.settings?.splitting_category_id ?? ""} /></label><label className="block">Settlement mode<select className="mt-1 w-full rounded border p-2" name="settlementMode" defaultValue={loaderData.settings?.settlement_mode ?? "simple"}><option value="simple">Simple</option><option value="detailed">Detailed</option></select></label><label className="block">Source account IDs (one per line)<textarea className="mt-1 w-full rounded border p-2" name="sourceAccountId" defaultValue={accounts.join("\n")} /></label><label className="block">Category mappings (JSON)<textarea className="mt-1 w-full rounded border p-2" name="categoryMappings" defaultValue={JSON.stringify(mappings)} /></label>{actionError && <p role="alert" className="text-red-700">{actionError}</p>}{saved && <p role="status" className="text-green-700">Settings saved.</p>}<button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">Save settings</button></Form><Form method="post" className="mt-4"><input type="hidden" name="intent" value="disconnect" /><button className="rounded border px-4 py-2" type="submit">Disconnect YNAB</button></Form></section>;
}
