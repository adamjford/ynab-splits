import { describe, expect, it } from "vitest";
import { allocateShares, debtFor, type LedgerEntry } from "./ledger";

describe("allocateShares", () => {
  it("allocates equal odd cents to the payer", () => {
    expect(allocateShares(1889, "adam", "chelsea", { type: "equal" })).toEqual([
      { memberId: "adam", amountMinor: 945 },
      { memberId: "chelsea", amountMinor: 944 },
    ]);
  });

  it("allocates a percentage in basis points", () => {
    expect(allocateShares(1250, "chelsea", "adam", { type: "percentage", otherBasisPoints: 5000 })).toEqual([
      { memberId: "chelsea", amountMinor: 625 },
      { memberId: "adam", amountMinor: 625 },
    ]);
  });

  it("supports an exact counterparty share and zero share", () => {
    expect(allocateShares(189, "adam", "chelsea", { type: "exact", otherAmountMinor: 0 })).toEqual([
      { memberId: "adam", amountMinor: 189 },
      { memberId: "chelsea", amountMinor: 0 },
    ]);
  });

  it.each([
    [{ type: "percentage", otherBasisPoints: -1 }, /percentage/i],
    [{ type: "percentage", otherBasisPoints: 10001 }, /percentage/i],
    [{ type: "exact", otherAmountMinor: -1 }, /exact/i],
    [{ type: "exact", otherAmountMinor: 190 }, /exact/i],
  ] as const)("rejects invalid split %j", (input, error) => {
    expect(() => allocateShares(189, "adam", "chelsea", input)).toThrow(error);
  });
});

describe("debtFor", () => {
  const expense: LedgerEntry = {
    id: "e1",
    kind: "expense",
    amountMinor: 1889,
    cashMemberId: "adam",
    shares: [
      { memberId: "adam", amountMinor: 945 },
      { memberId: "chelsea", amountMinor: 944 },
    ],
    date: "2026-01-01",
    description: "Amazon",
  };
  const income: LedgerEntry = {
    id: "e2",
    kind: "income",
    amountMinor: 1154,
    cashMemberId: "chelsea",
    shares: [
      { memberId: "chelsea", amountMinor: 577 },
      { memberId: "adam", amountMinor: 577 },
    ],
    date: "2026-01-02",
    description: "Refund",
  };

  it("makes the nonpayer owe their share for an expense", () => {
    expect(debtFor(expense, "chelsea")).toBe(944);
    expect(debtFor(expense, "adam")).toBe(-944);
  });

  it("makes the income recipient owe the other member's share", () => {
    expect(debtFor(income, "chelsea")).toBe(577);
    expect(debtFor(income, "adam")).toBe(-577);
  });
});
