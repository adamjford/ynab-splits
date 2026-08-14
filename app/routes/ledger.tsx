import { Link } from "react-router";
import type { Route } from "./+types/ledger";
import { formatMinorUnits, type CurrencyFormat } from "~/domain/money";
import { authenticatedUser, database } from "~/services/request.server";
import { loadEntries, toSharedLedgerEntry } from "~/services/ledger-query.server";
import { secureData } from "~/services/response.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    const user = authenticatedUser(request, db);
    const entries = loadEntries(db, user.householdId);
    const settings = db.prepare("select currency_iso_code, currency_decimal_digits from plan_settings where user_id = ?").get(user.id) as { currency_iso_code: string; currency_decimal_digits: number } | undefined;
    return secureData({
      currency: settings ? { isoCode: settings.currency_iso_code, decimalDigits: settings.currency_decimal_digits } satisfies CurrencyFormat : null,
      entries: entries.map(toSharedLedgerEntry),
    });
  } finally { db.close(); }
}

function displayAmount(amountMinor: number, currency: CurrencyFormat | null): string {
  const formatted = formatMinorUnits(amountMinor, currency);
  return typeof formatted === "string" ? formatted : formatted.message;
}

export default function Ledger({ loaderData }: Route.ComponentProps) {
  return <section><h1 className="text-3xl font-semibold">Shared ledger</h1><p className="mt-2 text-slate-600">Both members see the same ledger. YNAB identifiers and manual controls remain private to the owning member.</p><div className="mt-6 overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3">Amount</th><th className="p-3">Paid by</th><th className="p-3">Shares</th></tr></thead><tbody>{loaderData.entries.map((entry) => <tr className="border-b last:border-0" key={entry.id}><td className="p-3">{entry.date}</td><td className="p-3"><Link className="underline" to={`/ledger/${entry.id}`}>{entry.description}</Link></td><td className="p-3">{displayAmount(entry.amountMinor, loaderData.currency)}</td><td className="p-3">{entry.payerMemberKey}</td><td className="p-3">Adam {displayAmount(entry.shares.adam, loaderData.currency)} · Chelsea {displayAmount(entry.shares.chelsea, loaderData.currency)}</td></tr>)}</tbody></table>{loaderData.entries.length === 0 && <p className="p-4">No ledger entries yet.</p>}</div></section>;
}
