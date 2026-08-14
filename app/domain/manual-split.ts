export interface ManualSourceSubtransaction {
  id?: string;
  categoryId: string | null;
  amountMinor: number;
  payeeName?: string | null;
  memo?: string | null;
}

export interface ManualSourceTransaction {
  id: string;
  date: string;
  amountMinor: number;
  accountId: string;
  payeeName?: string | null;
  approved: boolean;
  subtransactions: ManualSourceSubtransaction[];
}

export interface OwnerAllocation {
  categoryId: string;
  amountMinor: number;
  payeeName?: string | null;
  memo?: string | null;
}

export interface ManualSplitLine {
  categoryId: string;
  amountMinor: number;
  payeeName?: string | null;
  memo?: string | null;
}
export interface ManualSplitTarget {
  parentAmountMinor: number;
  accountId: string;
  date: string;
  payeeName?: string | null;
  lines: ManualSplitLine[];
  approved: true;
}

export interface ManualVerification {
  matches: boolean;
  differences: string[];
}

export function buildManualSplitTarget(source: ManualSourceTransaction, memberShareMinor: number, ownerAllocations: OwnerAllocation[], splittingCategoryId: string): ManualSplitTarget {
  if (ownerAllocations.length === 0) throw new Error("at least one owner allocation is required");
  if (!Number.isSafeInteger(memberShareMinor)) throw new Error("owner share must be an integer");
  const ownerTotal = ownerAllocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (ownerTotal !== memberShareMinor) throw new Error("owner allocations must total the member share");
  const existingByCategory = new Map(source.subtransactions.filter((line) => line.categoryId !== splittingCategoryId).map((line) => [line.categoryId, line]));
  const ownerLines = ownerAllocations.map((allocation) => {
    const existing = existingByCategory.get(allocation.categoryId);
    return {
      categoryId: allocation.categoryId,
      amountMinor: allocation.amountMinor,
      payeeName: allocation.payeeName ?? existing?.payeeName ?? source.payeeName,
      memo: allocation.memo ?? existing?.memo ?? null,
    };
  });
  const splittingExisting = source.subtransactions.find((line) => line.categoryId === splittingCategoryId);
  const counterpartyAmount = source.amountMinor - ownerTotal;
  return {
    parentAmountMinor: source.amountMinor,
    accountId: source.accountId,
    date: source.date,
    payeeName: source.payeeName,
    lines: [...ownerLines, { categoryId: splittingCategoryId, amountMinor: counterpartyAmount, payeeName: splittingExisting?.payeeName ?? source.payeeName, memo: splittingExisting?.memo ?? null }],
    approved: true,
  };
}

export function verifyManualSplitReadback(source: ManualSourceTransaction, target: ManualSplitTarget): ManualVerification {
  const differences: string[] = [];
  if (source.amountMinor !== target.parentAmountMinor) differences.push(`parent amount: expected ${target.parentAmountMinor}, got ${source.amountMinor}`);
  if (source.accountId !== target.accountId) differences.push(`account: expected ${target.accountId}, got ${source.accountId}`);
  if (source.date !== target.date) differences.push(`date: expected ${target.date}, got ${source.date}`);
  if (source.payeeName !== target.payeeName) differences.push(`payee: expected ${target.payeeName ?? "(none)"}, got ${source.payeeName ?? "(none)"}`);
  if (source.approved !== target.approved) differences.push(`approved: expected ${target.approved}, got ${source.approved}`);
  const expected = target.lines.map((line) => `${line.categoryId}:${line.amountMinor}`).sort();
  const actual = source.subtransactions.map((line) => `${line.categoryId}:${line.amountMinor}`).sort();
  if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index])) differences.push(`split lines: expected ${expected.join(", ")}, got ${actual.join(", ")}`);
  return { matches: differences.length === 0, differences };
}
