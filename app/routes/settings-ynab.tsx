import { Form } from "react-router";
import type { Route } from "./+types/settings-ynab";
import { database, authenticatedUser } from "~/services/request.server";
import { savePlanSettings, setSourceAccounts } from "~/services/settings.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const settings = db.prepare("select plan_id, currency_iso_code, currency_decimal_digits, settlement_account_id, splitting_category_id, settlement_mode from plan_settings where user_id = ?").get(user.id) as { plan_id: string; currency_iso_code: string; currency_decimal_digits: number; settlement_account_id: string | null; splitting_category_id: string | null; settlement_mode: "simple" | "detailed" } | undefined;
    const accounts = db.prepare("select account_id from source_accounts where user_id = ? order by account_id").all(user.id) as Array<{ account_id: string }>;
    return { settings: settings ?? null, accounts: accounts.map((account) => account.account_id) };
  } finally { db.close(); }
}

export async function action({ request }: Route.ActionArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const form = await request.formData();
    const planId = String(form.get("planId") ?? "").trim();
    const currencyIsoCode = String(form.get("currencyIsoCode") ?? "").trim().toUpperCase();
    const currencyDecimalDigits = Number(form.get("currencyDecimalDigits") ?? 2);
    const settlementMode = String(form.get("settlementMode") ?? "simple");
    if (!planId || !currencyIsoCode || !["simple", "detailed"].includes(settlementMode)) return { error: "Plan, currency, and settlement mode are required." };
    const accountIds = form.getAll("sourceAccountId").flatMap((value) => String(value).split(/\r?\n/)).map((value) => value.trim()).filter(Boolean);
    savePlanSettings(db, user.id, { planId, currencyIsoCode, currencyDecimalDigits, settlementMode: settlementMode as "simple" | "detailed", settlementAccountId: String(form.get("settlementAccountId") ?? "") || undefined, splittingCategoryId: String(form.get("splittingCategoryId") ?? "") || undefined });
    setSourceAccounts(db, user.id, accountIds);
    return { saved: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Settings could not be saved" }; } finally { db.close(); }
}

export default function SettingsYnab({ loaderData, actionData }: Route.ComponentProps) {
  return <section className="max-w-2xl"><h1 className="text-3xl font-semibold">YNAB settings</h1><p className="mt-2 text-slate-600">Use IDs copied from your selected YNAB plan. These settings are private to your account.</p><Form method="post" className="mt-6 space-y-4 rounded border bg-white p-4"><label className="block">Plan ID<input className="mt-1 w-full rounded border p-2" name="planId" defaultValue={loaderData.settings?.plan_id ?? ""} required /></label><label className="block">Currency ISO code<input className="mt-1 w-full rounded border p-2" name="currencyIsoCode" defaultValue={loaderData.settings?.currency_iso_code ?? "USD"} required /></label><label className="block">Currency decimal digits<input className="mt-1 w-full rounded border p-2" name="currencyDecimalDigits" type="number" min="0" max="3" defaultValue={loaderData.settings?.currency_decimal_digits ?? 2} required /></label><label className="block">Source account ID(s), one per line<textarea className="mt-1 w-full rounded border p-2" name="sourceAccountId" defaultValue={loaderData.accounts.join("\n")} /></label><label className="block">Settlement account ID<input className="mt-1 w-full rounded border p-2" name="settlementAccountId" defaultValue={loaderData.settings?.settlement_account_id ?? ""} /></label><label className="block">Splitting category ID<input className="mt-1 w-full rounded border p-2" name="splittingCategoryId" defaultValue={loaderData.settings?.splitting_category_id ?? ""} /></label><label className="block">Settlement mode<select className="mt-1 w-full rounded border p-2" name="settlementMode" defaultValue={loaderData.settings?.settlement_mode ?? "simple"}><option value="simple">Simple / Chelsea Option One</option><option value="detailed">Detailed / Adam Option Two</option></select></label>{actionData?.error && <p role="alert" className="text-red-700">{actionData.error}</p>}{actionData?.saved && <p role="status" className="text-green-700">Settings saved.</p>}<button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">Save settings</button></Form></section>;
}
