import { describe, expect, it } from "vitest";
import { buildSettlementPreview } from "./settlement";
import type { LedgerEntry } from "./ledger";

const entries: LedgerEntry[] = [
  {
    id: "amazon",
    kind: "expense",
    amountMinor: 1889,
    cashMemberId: "adam",
    shares: [
      { memberId: "adam", amountMinor: 945 },
      { memberId: "chelsea", amountMinor: 944 },
    ],
    date: "2026-01-01",
    description: "Amazon",
  },
  {
    id: "parking",
    kind: "expense",
    amountMinor: 1250,
    cashMemberId: "chelsea",
    shares: [
      { memberId: "chelsea", amountMinor: 625 },
      { memberId: "adam", amountMinor: 625 },
    ],
    date: "2026-01-02",
    description: "Hospital Parking",
  },
];

describe("buildSettlementPreview", () => {
  it("returns net, direction, and entries behind both sides", () => {
    expect(buildSettlementPreview("adam", entries)).toEqual({
      netMinor: 319,
      direction: "owed",
      owes: [{ entryId: "parking", amountMinor: 625 }],
      owed: [{ entryId: "amazon", amountMinor: 944 }],
    });
  });

  it("reports a zero-net period without a transfer direction", () => {
    expect(
      buildSettlementPreview("adam", [
        ...entries,
        {
          id: "refund",
          kind: "income",
          amountMinor: 319,
          cashMemberId: "adam",
          shares: [
            { memberId: "adam", amountMinor: 0 },
            { memberId: "chelsea", amountMinor: 319 },
          ],
          date: "2026-01-03",
          description: "Refund",
        },
      ]),
    ).toMatchObject({ netMinor: 0, direction: "settled" });
  });

  it("skips voided entries before calculating debt", () => {
    const voided: LedgerEntry = {
      id: "voided",
      kind: "expense",
      amountMinor: 100,
      cashMemberId: "adam",
      shares: [
        { memberId: "adam", amountMinor: 50 },
        { memberId: "chelsea", amountMinor: 50 },
      ],
      date: "2026-01-04",
      description: "Voided",
      voidedAt: "2026-01-05T00:00:00Z",
    };
    expect(buildSettlementPreview("adam", [voided])).toEqual({
      netMinor: 0,
      direction: "settled",
      owes: [],
      owed: [],
    });
  });
});
