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
  it("keeps trailing periods open and reports signed transfer mismatches", () => {
    const open = parseLegacy2026(transactions.split("\n").slice(0, 2).join("\n"), splitView.split("\n").slice(0, 5).join("\n"));
    expect(open.periods.at(-1)?.entryKeys).toEqual(["sheet-2026:2"]);
    expect(open.periods.at(-1)?.transfer).toBeUndefined();

    const transferRows = `${transactions}\n2026-01-02,Settle Up,9.45,Adam,1,1`;
    const transferSplit = `${splitView}\n2026-01-02,Settle Up,9.45,Adam,,,,,,,,9.45,,9.45,0`;
    const report = parseLegacy2026(transferRows, transferSplit);
    expect(report.transfers).toEqual([expect.objectContaining({
      amountMinor: 945,
      debtorMemberKey: "adam",
      creditorMemberKey: "chelsea",
      recordedNetMinor: -945,
    })]);
    expect(report.periods.at(-1)).toMatchObject({ calculatedNetMinor: 944, transfer: expect.objectContaining({ amountMinor: 945 }) });
    expect(report.errors.join(" ")).toMatch(/calculated transfer|match/i);
  });

  it("fails closed on malformed CSV, missing headers, and unsupported members", () => {
    expect(parseLegacy2026("not,csv", "bad").rows).toEqual([]);
    expect(parseLegacy2026("Date,Name\n2026-01-01,x", splitView).errors.join(" ")).toMatch(/header/i);
    expect(parseLegacy2026(transactions.replace(",Adam,1,1", ",Taylor,1,1"), splitView).errors.join(" ")).toMatch(/payer/i);
  });
  it("reports row-level amount, split alignment, and share errors", () => {
    expect(parseLegacy2026(transactions.replace("18.89,Adam", "not-money,Adam"), splitView).errors.join(" ")).toMatch(/invalid amount/i);
    expect(parseLegacy2026(transactions, splitView.replace("18.89,Adam,,,,,,,,9.44", "not-money,Adam,,,,,,,,9.44")).errors.join(" ")).toMatch(/split view amount/i);
    expect(parseLegacy2026(transactions, splitView.replace("9.44,,9.45,9.44", "20.00,,9.45,9.44")).errors.join(" ")).toMatch(/exceeds total/i);
    expect(parseLegacy2026(transactions, splitView.split("\n").slice(0, 4).join("\n")).errors.join(" ")).toMatch(/missing Split View row/i);
    expect(parseLegacy2026(transactions, splitView.replace("2026-01-01,Amazon", "2026-01-02,Amazon")).errors.join(" ")).toMatch(/identity mismatch/i);
  });

  it("parses signed income and currency amounts while filtering other years", () => {
    const source = `Date,Name,Amount (negative if income),Paid/received by
2026-02-01,Refund,"-$1,234.50",Chelsea
2025-02-01,Old,$10.00,Adam`;
    const split = `ignored
ignored
Date,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea
spacer
2026-02-01,Refund,"-$1,234.50",Chelsea,,,,,,,,$123.45,,12345,0
2025-02-01,Old,$10.00,Adam,,,,,,,,5,,5,5`;
    const report = parseLegacy2026(source, split);
    expect(report.errors).toEqual([]);
    expect(report.rows).toEqual([expect.objectContaining({
      kind: "income",
      amountMinor: 123450,
      cashMemberKey: "chelsea",
      shares: { adam: 12345, chelsea: 111105 },
    })]);
  });

  it("rejects malformed CSV and required Split View columns", () => {
    expect(parseLegacy2026(`Date,Name
"unterminated`, splitView).errors.join(" ")).toMatch(/quote|csv|invalid/i);
    const badColumns = splitView.replace("Paid/received by amount", "Wrong amount");
    expect(parseLegacy2026(transactions, badColumns).errors.join(" ")).toMatch(/columns L/i);
  });
  it("covers both payer directions and signed transfer branches", () => {
    const source = `Date,Name,Amount (negative if income),Paid/received by
2026-02-01,Refund,-10.00,Chelsea
2026-02-02,Gift,10.00,Adam
2026-02-03,Settle Up,-5.00,Chelsea`;
    const split = `ignored
ignored
Date,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea
spacer
2026-02-01,Refund,-10.00,Chelsea,,,,,,,,-5.00,,0,5.00
2026-02-02,Gift,10.00,Adam,,,,,,,,5.00,,5.00,5.00
2026-02-03,Settle Up,-5.00,Chelsea,,,,,,,,-5.00,,5.00,0`;
    const report = parseLegacy2026(source, split);
    expect(report.rows).toHaveLength(2);
    expect(report.transfers[0]).toMatchObject({ debtorMemberKey: "adam", creditorMemberKey: "chelsea", recordedNetMinor: -500 });
  });

  it("reports invalid optional values and transfer share precision", () => {
    const invalidCounterparty = splitView.replace("9.44,,9.45,9.44", "not-money,,9.45,9.44");
    expect(parseLegacy2026(transactions, invalidCounterparty).errors.join(" ")).toMatch(/counterparty amount/i);
    const malformedOptional = transactions.replace("18.89,Adam", "18.89,");
    expect(parseLegacy2026(malformedOptional, splitView).errors.join(" ")).toMatch(/payer/i);
  });
  it("covers expense-by-Chelsea and income-by-Adam debt directions", () => {
    const source = `Date,Name,Amount (negative if income),Paid/received by
2026-03-01,Expense,10.00,Chelsea
2026-03-02,Income,-10.00,Adam`;
    const split = `ignored
ignored
Date,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea
spacer
2026-03-01,Expense,10.00,Chelsea,,,,,,,,5.00,,5.00,5.00
2026-03-02,Income,10.00,Adam,,,,,,,,5.00,,5.00,5.00`;
    expect(parseLegacy2026(source, split).errors).toEqual([]);
  });
  it("handles Adam-debtor transfers and the equality path", () => {
    const source = `Date,Name,Amount (negative if income),Paid/received by
2026-04-01,Amazon,10.00,Adam
2026-04-02,Settle Up,-5.00,Adam`;
    const split = `ignored
ignored
Date,Name,Amount,payer,x,x,x,x,x,x,x,Paid/received by amount,x,Adam,Chelsea
spacer
2026-04-01,Amazon,10.00,Adam,,,,,,,,5.00,,5.00,5.00
2026-04-02,Settle Up,5.00,Adam,,,,,,,,5.00,,5.00,0`;
    const report = parseLegacy2026(source, split);
    expect(report.transfers[0]).toMatchObject({ debtorMemberKey: "chelsea", creditorMemberKey: "adam" });
    expect(report.errors).toEqual([]);
    expect(parseLegacy2026("Date,Name,Amount (negative if income),Paid/received by\n2026-05-01", splitView).errors.join(" ")).toMatch(/invalid amount/i);
  });
});
