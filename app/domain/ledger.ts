export type MemberId = string;

export type SplitInput =
  { type: "equal" } | { type: "percentage"; otherBasisPoints: number } | { type: "exact"; otherAmountMinor: number };

export interface MemberShare {
  memberId: MemberId;
  amountMinor: number;
}

export interface YnabSourceIdentity {
  planId: string;
  transactionId: string;
  accountId: string;
  sourceAmountMilliunits: number;
}

export interface LedgerEntry {
  id: string;
  kind: "expense" | "income";
  amountMinor: number;
  cashMemberId: MemberId;
  shares: [MemberShare, MemberShare];
  date: string;
  description: string;
  categoryId?: string;
  source?: YnabSourceIdentity;
  voidedAt?: string;
  correctionOfId?: string;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day >= 1 && day <= daysInMonth;
}

function validateTotal(totalMinor: number): void {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new RangeError("total must be a positive minor-unit integer");
  }
}

export function allocateShares(
  totalMinor: number,
  cashMemberId: MemberId,
  otherMemberId: MemberId,
  input: SplitInput,
): [MemberShare, MemberShare] {
  validateTotal(totalMinor);
  if (cashMemberId === otherMemberId) throw new Error("members must be distinct");

  let otherAmount: number;
  if (input.type === "equal") {
    otherAmount = Math.floor(totalMinor / 2);
  } else if (input.type === "percentage") {
    if (!Number.isInteger(input.otherBasisPoints) || input.otherBasisPoints < 0 || input.otherBasisPoints > 10_000) {
      throw new RangeError("percentage must be from 0 through 10000 basis points");
    }
    otherAmount = Number((BigInt(totalMinor) * BigInt(input.otherBasisPoints)) / 10_000n);
  } else {
    if (
      !Number.isSafeInteger(input.otherAmountMinor) ||
      input.otherAmountMinor < 0 ||
      input.otherAmountMinor > totalMinor
    ) {
      throw new RangeError("exact share must be from zero through the total");
    }
    otherAmount = input.otherAmountMinor;
  }

  return [
    { memberId: cashMemberId, amountMinor: totalMinor - otherAmount },
    { memberId: otherMemberId, amountMinor: otherAmount },
  ];
}

export function debtFor(entry: LedgerEntry, memberId: MemberId): number {
  const memberShare = entry.shares.find((share) => share.memberId === memberId);
  const otherShare = entry.shares.find((share) => share.memberId !== memberId);
  if (!memberShare || !otherShare) throw new Error("entry must contain exactly two distinct members");
  if (entry.kind === "expense") {
    return memberId === entry.cashMemberId ? -otherShare.amountMinor : memberShare.amountMinor;
  }
  return memberId === entry.cashMemberId ? otherShare.amountMinor : -memberShare.amountMinor;
}

export function assertLedgerEntry(entry: LedgerEntry): void {
  validateTotal(entry.amountMinor);
  if (entry.shares.length !== 2 || entry.shares[0].memberId === entry.shares[1].memberId) {
    throw new Error("ledger entry must have exactly two distinct member shares");
  }
  const firstShare = entry.shares[0];
  const secondShare = entry.shares[1];
  if (firstShare.memberId !== entry.cashMemberId && secondShare.memberId !== entry.cashMemberId) {
    throw new Error("ledger entry cash member must have a share");
  }
  if (
    !Number.isSafeInteger(firstShare.amountMinor) ||
    !Number.isSafeInteger(secondShare.amountMinor) ||
    firstShare.amountMinor < 0 ||
    secondShare.amountMinor < 0
  ) {
    throw new Error("ledger shares must be non-negative and sum to the entry total");
  }
  if (BigInt(firstShare.amountMinor) + BigInt(secondShare.amountMinor) !== BigInt(entry.amountMinor)) {
    throw new Error("ledger shares must be non-negative and sum to the entry total");
  }
  if (!isCalendarDate(entry.date) || !entry.description.trim()) {
    throw new Error("ledger entry requires a date and description");
  }
}
