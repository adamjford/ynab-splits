import { describe, expect, it } from "vitest";
import { buildSettlementTarget } from "./settlement-posting";
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
});
