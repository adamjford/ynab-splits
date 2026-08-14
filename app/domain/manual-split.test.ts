import { describe, expect, it } from "vitest";
import { buildManualSplitTarget, verifyManualSplitReadback } from "./manual-split";

describe("manual split targets", () => {
  const source = {
    id: "t1",
    date: "2026-01-01",
    amountMinor: -1889,
    accountId: "a1",
    payeeName: "Amazon",
    approved: false,
    subtransactions: [
      { id: "s1", categoryId: "groceries", amountMinor: -945, payeeName: "Amazon", memo: "owner" },
      { id: "s2", categoryId: "splitting", amountMinor: -944, payeeName: "Amazon", memo: "counterparty" },
    ],
  };

  it("preserves owner lines and replaces the counterparty line deterministically", () => {
    expect(buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting")).toEqual({
      parentAmountMinor: -1889,
      accountId: "a1",
      date: "2026-01-01",
      payeeName: "Amazon",
      lines: [
        { categoryId: "groceries", amountMinor: -945, payeeName: "Amazon", memo: "owner" },
        { categoryId: "splitting", amountMinor: -944, payeeName: "Amazon", memo: "counterparty" },
      ],
      approved: true,
    });
  });

  it("verifies readback with order-independent category/amount matching", () => {
    const target = buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting");
    expect(verifyManualSplitReadback({ ...source, approved: true, subtransactions: [...source.subtransactions].reverse() }, target)).toEqual({ matches: true, differences: [] });
    expect(verifyManualSplitReadback({ ...source, approved: false, subtransactions: source.subtransactions }, target).matches).toBe(false);
  });
});
