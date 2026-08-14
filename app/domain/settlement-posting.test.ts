import { describe, expect, it, vi } from "vitest";
import { buildSettlementTarget, settlementImportId } from "./settlement-posting";
import type { LedgerEntry } from "./ledger";

const entries: LedgerEntry[] = [
  { id: "amazon", kind: "expense", amountMinor: 1889, cashMemberId: "adam", categoryId: "groceries", shares: [{ memberId: "adam", amountMinor: 945 }, { memberId: "chelsea", amountMinor: 944 }], date: "2026-01-01", description: "Amazon" },
  { id: "parking", kind: "expense", amountMinor: 1250, cashMemberId: "chelsea", categoryId: "hospital", shares: [{ memberId: "chelsea", amountMinor: 625 }, { memberId: "adam", amountMinor: 625 }], date: "2026-01-02", description: "Parking" },
];

describe("buildSettlementTarget", () => {
  it("builds Adam's detailed Option Two shape", () => {
    expect(buildSettlementTarget("adam", entries, "detailed", "splitting")).toEqual({ parentAmountMinor: 319, payee: "Chelsea", categoryId: null, subtransactions: [{ amountMinor: -625, categoryId: "hospital", memo: "YS:parking" }, { amountMinor: 944, categoryId: "splitting", memo: "YS:aggregate" }] });
  });

  it("builds a simple whole transfer", () => {
    expect(buildSettlementTarget("chelsea", entries, "simple", "splitting")).toMatchObject({ parentAmountMinor: -319, categoryId: "splitting", subtransactions: [] });
  });
  it("resolves detailed source categories only through the destination mapping", () => {
    expect(buildSettlementTarget("adam", entries, "detailed", "splitting", new Map([["hospital", "dest-hospital"]]))).toMatchObject({
      subtransactions: [{ amountMinor: -625, categoryId: "dest-hospital" }, { amountMinor: 944, categoryId: "splitting" }],
    });
    expect(() => buildSettlementTarget("adam", entries, "detailed", "splitting", {})).toThrow(/mapping/i);
  });

  it("supports resolver functions, validates Splitting, and emits bounded stable import IDs", () => {
    expect(buildSettlementTarget("adam", entries, "detailed", "splitting", (source) => source === "hospital" ? "mapped" : null).subtransactions[0].categoryId).toBe("mapped");
    expect(() => buildSettlementTarget("adam", entries, "simple", " ")).toThrow(/Splitting/i);
    const id = settlementImportId("posting-123");
    expect(id.length).toBeLessThanOrEqual(36);
    expect(settlementImportId("posting-123")).toBe(id);
    expect(settlementImportId("posting-456")).not.toBe(id);
  });

  it("encodes a final partial base32 quantum when the digest length is not divisible by five bits", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", () => ({
      createHash: () => ({
        update: () => ({
          digest: () => new Uint8Array(19).fill(1),
        }),
      }),
    }));
    const mocked = await import("./settlement-posting");
    const encoded = mocked.settlementImportId("partial-digest");
    expect(encoded).toMatch(/^YS:[A-Z2-7]+$/);
    expect(encoded.length).toBeLessThanOrEqual(36);
    vi.doUnmock("node:crypto");
    vi.resetModules();
  });

  it("uses the Splitting category for uncategorized debt and omits zero aggregate lines", () => {
    const uncategorized: LedgerEntry = {
      ...entries[1],
      id: "uncategorized",
      categoryId: undefined,
    };
    expect(buildSettlementTarget("adam", [uncategorized], "detailed", "splitting")).toEqual({
      parentAmountMinor: -625,
      payee: "Chelsea",
      categoryId: null,
      subtransactions: [{ amountMinor: -625, categoryId: "splitting", memo: "YS:uncategorized" }],
    });
  });

  it("handles zero debt without creating a line", () => {
    const zeroDebt = {
      ...entries[0],
      id: "zero",
      shares: [{ memberId: "adam", amountMinor: 1889 }, { memberId: "chelsea", amountMinor: 0 }],
    } satisfies LedgerEntry;
    expect(buildSettlementTarget("adam", [zeroDebt], "detailed", "splitting")).toMatchObject({
      parentAmountMinor: 0,
      subtransactions: [],
    });
  });

  it("rejects blank mapped destination categories", () => {
    expect(() => buildSettlementTarget("adam", entries, "detailed", "splitting", new Map([["hospital", "  "]]))).toThrow(/mapping/i);
  });

  it("reports impossible subtransaction totals instead of posting malformed data", () => {
    const malformed = {
      ...entries[0],
      amountMinor: Number.NaN,
      shares: [{ memberId: "adam", amountMinor: 0 }, { memberId: "chelsea", amountMinor: Number.NaN }],
    } satisfies LedgerEntry;
    expect(() => buildSettlementTarget("adam", [malformed], "detailed", "splitting")).toThrow(/sum to parent/i);
  });
});
