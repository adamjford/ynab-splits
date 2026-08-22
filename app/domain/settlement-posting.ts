import { createHash } from "node:crypto";
import { debtFor, type LedgerEntry, type MemberId } from "./ledger";
import { buildSettlementPreview } from "./settlement";

export interface SettlementSubtransaction {
  amountMinor: number;
  categoryId: string;
  memo: string;
}

export interface SettlementTarget {
  parentAmountMinor: number;
  payee: string;
  categoryId: string | null;
  subtransactions: SettlementSubtransaction[];
}

/**
 * Resolve a source category to the category in the posting owner's selected plan.
 * A resolver is deliberately explicit: silently reusing a source-plan ID can post
 * to the wrong plan (or fail in an opaque way).
 */
export type DestinationCategoryResolver =
  Map<string, string> | Record<string, string | undefined> | ((sourceCategoryId: string) => string | null | undefined);

function resolveDestinationCategory(sourceCategoryId: string, resolver?: DestinationCategoryResolver): string | null {
  if (!resolver) return sourceCategoryId;
  const destination =
    typeof resolver === "function"
      ? resolver(sourceCategoryId)
      : resolver instanceof Map
        ? resolver.get(sourceCategoryId)
        : resolver[sourceCategoryId];
  return destination?.trim() || null;
}

export function buildSettlementTarget(
  memberId: MemberId,
  entries: LedgerEntry[],
  mode: "simple" | "detailed",
  splittingCategoryId: string,
  destinationResolver?: DestinationCategoryResolver,
): SettlementTarget {
  if (!splittingCategoryId.trim()) throw new Error("destination Splitting category is required");
  const preview = buildSettlementPreview(memberId, entries);
  const counterparty = memberId === "adam" ? "Chelsea" : "Adam";
  if (mode === "simple")
    return {
      parentAmountMinor: preview.netMinor,
      payee: counterparty,
      categoryId: splittingCategoryId,
      subtransactions: [],
    };

  const subtransactions: SettlementSubtransaction[] = [];
  let aggregateSplitting = 0;
  for (const entry of entries) {
    if (entry.voidedAt) continue;
    const debt = debtFor(entry, memberId);
    if (debt > 0) {
      const categoryId = entry.categoryId
        ? resolveDestinationCategory(entry.categoryId, destinationResolver)
        : splittingCategoryId;
      if (!categoryId) throw new Error(`Missing destination category mapping for ${entry.categoryId}`);
      subtransactions.push({ amountMinor: -debt, categoryId, memo: `YS:${entry.id}` });
    }
    if (debt < 0) aggregateSplitting += -debt;
  }
  if (aggregateSplitting !== 0)
    subtransactions.push({ amountMinor: aggregateSplitting, categoryId: splittingCategoryId, memo: "YS:aggregate" });
  if (subtransactions.reduce((sum, line) => sum + line.amountMinor, 0) !== preview.netMinor)
    throw new Error("settlement subtransactions must sum to parent");
  return { parentAmountMinor: preview.netMinor, payee: counterparty, categoryId: null, subtransactions };
}

/** Stable, URL-safe import IDs are short enough for YNAB's 36-character limit. */
export function settlementImportId(postingId: string): string {
  const bytes = createHash("sha256").update(postingId).digest().subarray(0, 20);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
  return `YS:${encoded}`.slice(0, 36);
}
