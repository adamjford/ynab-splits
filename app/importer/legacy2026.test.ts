import { describe, expect, it } from "vitest";
import { parseLegacy2026 } from "./legacy2026";

const transactions = `Date,Name,Amount (negative if income),Paid/received by,Other's share (default: 1),Payer's share (default: 1)\n2026-01-01,Amazon,18.89,Adam,1,1\n2025-12-31,Old,10.00,Adam,1,1`;
const splitView = `ignored\nignored\nDate,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea\na,b,c,d,e,f,g,h,i,j,k,l,m,n,o\n2026-01-01,Amazon,18.89,Adam,,,,,,,,9.44,,9.45,9.44\n2025-12-31,Old,10.00,Adam,,,,,,,,5.00,,5.00,5.00`;

describe("parseLegacy2026", () => {
  it("imports only 2026 and preserves recorded odd-cent shares", () => {
    const report = parseLegacy2026(transactions, splitView);
    expect(report.errors).toEqual([]);
    expect(report.rows).toEqual([expect.objectContaining({
      legacyKey: "sheet-2026:2",
      kind: "expense",
      amountMinor: 1889,
      shares: { adam: 945, chelsea: 944 },
    })]);
  });

  it("reports row identity mismatches without producing rows", () => {
    expect(parseLegacy2026(transactions.replace("Amazon", "Wrong"), splitView).errors.join(" ")).toMatch(/identity|name/i);
  });
});
