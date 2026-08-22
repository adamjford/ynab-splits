import { describe, expect, it } from "vitest";
import { allocateShares, assertLedgerEntry, debtFor, type LedgerEntry } from "./ledger";

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

  it("calculates percentage shares exactly at the safe-integer boundary", () => {
    const totalMinor = Number.MAX_SAFE_INTEGER;
    const otherBasisPoints = 121;

    expect(allocateShares(totalMinor, "adam", "chelsea", { type: "percentage", otherBasisPoints })).toEqual([
      { memberId: "adam", amountMinor: 8898212143758626 },
      { memberId: "chelsea", amountMinor: 108987110982365 },
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

describe("ledger validation", () => {
  const valid: LedgerEntry = {
    id: "valid",
    kind: "expense",
    amountMinor: 10,
    cashMemberId: "adam",
    shares: [
      { memberId: "adam", amountMinor: 6 },
      { memberId: "chelsea", amountMinor: 4 },
    ],
    date: "2026-01-01",
    description: "Groceries",
  };

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid totals %s",
    (total) => {
      expect(() => allocateShares(total, "adam", "chelsea", { type: "equal" })).toThrow(/positive minor-unit integer/i);
    },
  );

  it("rejects identical member identities", () => {
    expect(() => allocateShares(10, "adam", "adam", { type: "equal" })).toThrow(/distinct/i);
  });

  it("rejects non-integer and out-of-range percentages", () => {
    expect(() => allocateShares(10, "adam", "chelsea", { type: "percentage", otherBasisPoints: 1.5 })).toThrow(
      /percentage/i,
    );
    expect(() => allocateShares(10, "adam", "chelsea", { type: "percentage", otherBasisPoints: Number.NaN })).toThrow(
      /percentage/i,
    );
    expect(() =>
      allocateShares(10, "adam", "chelsea", { type: "percentage", otherBasisPoints: Number.POSITIVE_INFINITY }),
    ).toThrow(/percentage/i);
  });

  it("rejects unsafe exact shares", () => {
    expect(() =>
      allocateShares(10, "adam", "chelsea", { type: "exact", otherAmountMinor: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/exact/i);
    expect(() => allocateShares(10, "adam", "chelsea", { type: "exact", otherAmountMinor: 1.5 })).toThrow(/exact/i);
  });

  it("rejects debt lookup when a member or counterpart is missing", () => {
    expect(() => debtFor(valid, "nobody")).toThrow(/exactly two distinct/i);
    expect(() =>
      debtFor(
        {
          ...valid,
          shares: [
            { memberId: "adam", amountMinor: 10 },
            { memberId: "adam", amountMinor: 0 },
          ],
        },
        "adam",
      ),
    ).toThrow(/exactly two distinct/i);
  });

  it("validates share count, identity, total, date, and description", () => {
    expect(() =>
      assertLedgerEntry({ ...valid, shares: [valid.shares[0]] as unknown as LedgerEntry["shares"] }),
    ).toThrow(/exactly two/i);
    expect(() =>
      assertLedgerEntry({
        ...valid,
        shares: [
          { memberId: "adam", amountMinor: 5 },
          { memberId: "adam", amountMinor: 5 },
        ],
      }),
    ).toThrow(/exactly two/i);
    expect(() =>
      assertLedgerEntry({
        ...valid,
        shares: [
          { memberId: "adam", amountMinor: -1 },
          { memberId: "chelsea", amountMinor: 11 },
        ],
      }),
    ).toThrow(/non-negative/i);
    expect(() =>
      assertLedgerEntry({
        ...valid,
        shares: [
          { memberId: "adam", amountMinor: 5 },
          { memberId: "chelsea", amountMinor: 6 },
        ],
      }),
    ).toThrow(/sum/i);
    expect(() =>
      assertLedgerEntry({
        ...valid,
        cashMemberId: "nobody",
      }),
    ).toThrow(/cash member.*share/i);
    expect(() => assertLedgerEntry({ ...valid, date: "01-01-2026" })).toThrow(/date/i);
    expect(() => assertLedgerEntry({ ...valid, description: "   " })).toThrow(/date and description/i);
    expect(() => assertLedgerEntry(valid)).not.toThrow();
  });
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"])("rejects impossible calendar dates %s", (date) => {
    expect(() => assertLedgerEntry({ ...valid, date })).toThrow(/date/i);
  });

  it("accepts leap-day and month-end calendar dates", () => {
    expect(() => assertLedgerEntry({ ...valid, date: "2024-02-29" })).not.toThrow();
    expect(() => assertLedgerEntry({ ...valid, date: "2026-04-30" })).not.toThrow();
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-integral, non-finite, or unsafe share amounts %s",
    (amountMinor) => {
      expect(() =>
        assertLedgerEntry({
          ...valid,
          shares: [
            { memberId: "adam", amountMinor },
            { memberId: "chelsea", amountMinor: 4 },
          ],
        }),
      ).toThrow(/non-negative/i);
    },
  );

  it("accepts odd and zero-valued shares", () => {
    expect(() =>
      assertLedgerEntry({
        ...valid,
        amountMinor: 11,
        shares: [
          { memberId: "adam", amountMinor: 6 },
          { memberId: "chelsea", amountMinor: 5 },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      assertLedgerEntry({
        ...valid,
        shares: [
          { memberId: "adam", amountMinor: 10 },
          { memberId: "chelsea", amountMinor: 0 },
        ],
      }),
    ).not.toThrow();
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
