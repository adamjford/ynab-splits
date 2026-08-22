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
  it("includes normalized payee and memo in order-independent tuple matching", () => {
    const target = buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945, payeeName: " Amazon ", memo: " OWNER " }], "splitting");
    const reordered = { ...source, approved: true, subtransactions: [
      { ...source.subtransactions[1], payeeName: "amazon", memo: "counterparty" },
      { ...source.subtransactions[0], payeeName: "amazon", memo: "owner" },
    ] };
    expect(verifyManualSplitReadback(reordered, target).matches).toBe(true);
    expect(verifyManualSplitReadback({ ...reordered, subtransactions: [{ ...reordered.subtransactions[0], memo: "tampered" }, reordered.subtransactions[1]] }, target).differences.join(" ")).toMatch(/memo|split lines/i);
  });

  it("rejects missing allocations, non-integer shares, and mismatched totals", () => {
    expect(() => buildManualSplitTarget(source, -945, [], "splitting")).toThrow(/at least one/i);
    expect(() => buildManualSplitTarget(source, Number.NaN, [{ categoryId: "groceries", amountMinor: -945 }], "splitting")).toThrow(/integer/i);
    expect(() => buildManualSplitTarget(source, -944, [{ categoryId: "groceries", amountMinor: -945 }], "splitting")).toThrow(/total/i);
  });

  it("rejects every non-safe-integer owner allocation amount", () => {
    for (const amountMinor of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MIN_SAFE_INTEGER - 1,
    ]) {
      expect(() => buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor }], "splitting")).toThrow(/safe integer/i);
    }
  });

  it("uses explicit allocation metadata and safe fallbacks for new lines", () => {
    const target = buildManualSplitTarget(
      { ...source, amountMinor: -10, payeeName: null, subtransactions: [] },
      -10,
      [{ categoryId: "new-category", amountMinor: -10, payeeName: " Owner ", memo: " memo " }],
      "splitting",
    );
    expect(target.lines).toEqual([
      { categoryId: "new-category", amountMinor: -10, payeeName: " Owner ", memo: " memo " },
      { categoryId: "splitting", amountMinor: 0, payeeName: null, memo: null },
    ]);
  });

  it("falls back to source metadata when an allocation category is new", () => {
    const target = buildManualSplitTarget(
      { ...source, amountMinor: -10, payeeName: "Source", subtransactions: [] },
      -10,
      [{ categoryId: "new-category", amountMinor: -10 }],
      "splitting",
    );
    expect(target.lines).toEqual([
      { categoryId: "new-category", amountMinor: -10, payeeName: "Source", memo: null },
      { categoryId: "splitting", amountMinor: 0, payeeName: "Source", memo: null },
    ]);
  });

  it("reports every readback identity and line difference", () => {
    const target = {
      ...buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting"),
      parentId: "expected-parent",
    };
    const verification = verifyManualSplitReadback({
      ...source,
      id: "actual-parent",
      amountMinor: -1900,
      accountId: "actual-account",
      date: "2026-02-01",
      payeeName: "Different payee",
      approved: false,
      subtransactions: [{ categoryId: "other", amountMinor: -1 }],
    }, target);
    expect(verification.matches).toBe(false);
    expect(verification.differences).toEqual(expect.arrayContaining([
      "parent: expected expected-parent, got actual-parent",
      "parent amount: expected -1889, got -1900",
      "account: expected a1, got actual-account",
      "date: expected 2026-01-01, got 2026-02-01",
      "payee: expected Amazon, got Different payee",
      "approved: expected true, got false",
      "split lines differ by category, amount, payee, or memo",
    ]));
  });
  it("normalizes an absent payee on both source and target", () => {
    const sourceWithoutPayee = { ...source, payeeName: undefined };
    const targetWithoutPayee = buildManualSplitTarget(sourceWithoutPayee, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting");
    expect(verifyManualSplitReadback({ ...sourceWithoutPayee, approved: true }, targetWithoutPayee)).toEqual({ matches: true, differences: [] });
  });

  it("uses stable none labels when a mismatched payee is absent on either side", () => {
    const target = buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting");
    expect(verifyManualSplitReadback({ ...source, payeeName: undefined, approved: true }, target).differences).toContain("payee: expected Amazon, got (none)");
    expect(verifyManualSplitReadback({ ...source, approved: true }, { ...target, payeeName: undefined }).differences).toContain("payee: expected (none), got Amazon");
  });
  it("accepts an omitted parent id when all other fields and lines match", () => {
    const target = buildManualSplitTarget(source, -945, [{ categoryId: "groceries", amountMinor: -945 }], "splitting");
    expect(verifyManualSplitReadback({ ...source, approved: true }, target)).toEqual({ matches: true, differences: [] });
  });
});
