import { parse } from "csv-parse/sync";

export interface LegacyImportRow {
  legacyKey: string;
  sourceRow: number;
  kind: "expense" | "income";
  amountMinor: number;
  date: string;
  description: string;
  cashMemberKey: "adam" | "chelsea";
  shares: { adam: number; chelsea: number };
}

export interface LegacyTransfer {
  sourceRow: number;
  date: string;
  amountMinor: number;
  debtorMemberKey: "adam" | "chelsea";
  creditorMemberKey: "adam" | "chelsea";
  /** The signed amount represented by the workbook transfer (Adam's perspective). */
  recordedNetMinor: number;
}

export interface LegacyPeriod {
  entryKeys: string[];
  calculatedNetMinor: number;
  transfer?: LegacyTransfer;
}

export interface LegacyImportReport {
  rows: LegacyImportRow[];
  errors: string[];
  transfers: LegacyTransfer[];
  periods: LegacyPeriod[];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseMinor(value: string): number {
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`invalid amount ${value}`);
  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  return sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

function headerIndex(header: string[], name: string): number {
  const index = header.findIndex((value) => normalize(value) === normalize(name));
  if (index < 0) throw new Error(`missing required header ${name}`);
  return index;
}

function parseCsv(text: string): string[][] {
  return parse(text, { relax_column_count: true, skip_empty_lines: false, bom: true }) as string[][];
}

function rowDebtForAdam(row: LegacyImportRow): number {
  const otherShare = row.cashMemberKey === "adam" ? row.shares.chelsea : row.shares.adam;
  const ownShare = row.cashMemberKey === "adam" ? row.shares.adam : row.shares.chelsea;
  if (row.kind === "expense") return row.cashMemberKey === "adam" ? -otherShare : ownShare;
  return row.cashMemberKey === "adam" ? otherShare : -ownShare;
}

function emptyReport(errors: string[] = []): LegacyImportReport {
  return { rows: [], transfers: [], periods: [], errors };
}

/**
 * Parse the two workbook exports without changing their row alignment.
 *
 * Split View has two title rows and one blank spacer row, so source row N is
 * represented by Split View row N+3. The amount signs are retained while
 * calculating each period; only the persisted transfer amount is absolute.
 */
export function parseLegacy2026(transactionsCsv: string, splitViewCsv: string): LegacyImportReport {
  const rows: LegacyImportRow[] = [];
  const errors: string[] = [];
  const transfers: LegacyTransfer[] = [];
  const periods: LegacyPeriod[] = [];
  let currentKeys: string[] = [];
  let currentNet = 0;
  let transactions: string[][];
  let splitView: string[][];
  try {
    transactions = parseCsv(transactionsCsv);
    splitView = parseCsv(splitViewCsv);
  } catch (error) {
    return emptyReport([error instanceof Error ? error.message : "invalid CSV"]);
  }
  if (transactions.length === 0 || splitView.length < 3) return emptyReport(["both CSV files require headers and data"]);

  const sourceHeader = transactions[0];
  const splitHeader = splitView[2];
  let sourceDate: number, sourceName: number, sourceAmount: number, sourcePayer: number;
  let splitDate: number, splitName: number, splitAmount: number, splitPayer: number, splitCounterpartyAmount: number;
  try {
    sourceDate = headerIndex(sourceHeader, "Date");
    sourceName = headerIndex(sourceHeader, "Name");
    sourceAmount = headerIndex(sourceHeader, "Amount (negative if income)");
    sourcePayer = headerIndex(sourceHeader, "Paid/received by");
    splitDate = headerIndex(splitHeader, "Date");
    splitName = headerIndex(splitHeader, "Name");
    splitAmount = headerIndex(splitHeader, "Amount");
    splitPayer = headerIndex(splitHeader, "payer");
    splitCounterpartyAmount = 11;
    if (normalize(splitHeader[splitCounterpartyAmount] ?? "") !== normalize("Paid/received by amount") || normalize(splitHeader[13] ?? "") !== "adam" || normalize(splitHeader[14] ?? "") !== "chelsea") throw new Error("Split View requires columns L, N=Adam, and O=Chelsea");
  } catch (error) {
    return emptyReport([error instanceof Error ? error.message : "invalid headers"]);
  }

  for (let sourceIndex = 1; sourceIndex < transactions.length; sourceIndex += 1) {
    const source = transactions[sourceIndex];
    const sourceRow = sourceIndex + 1;
    const date = source[sourceDate];
    if (!date || !date.startsWith("2026-")) continue;
    const description = source[sourceName]?.trim() ?? "";
    let amountMinor: number;
    try {
      amountMinor = parseMinor(source[sourceAmount] ?? "");
    } catch (error) {
      errors.push(`row ${sourceRow}: ${error instanceof Error ? error.message : "invalid amount"}`);
      continue;
    }
    const payer = normalize(source[sourcePayer] ?? "");
    if (payer !== "adam" && payer !== "chelsea") {
      errors.push(`row ${sourceRow}: payer must be Adam or Chelsea`);
      continue;
    }
    const split = splitView[sourceIndex + 3];
    if (!split) {
      errors.push(`row ${sourceRow}: missing Split View row ${sourceIndex + 3}`);
      continue;
    }
    let splitAmountMinor: number;
    try {
      splitAmountMinor = parseMinor(split[splitAmount] ?? "");
    } catch {
      errors.push(`row ${sourceRow}: invalid Split View amount`);
      continue;
    }
    if (split[splitDate] !== date || split[splitName]?.trim() !== description || Math.abs(splitAmountMinor) !== Math.abs(amountMinor) || normalize(split[splitPayer] ?? "") !== payer) {
      errors.push(`row ${sourceRow}: source and Split View identity mismatch`);
      continue;
    }
    if (normalize(description) === "settle up") {
      const amount = Math.abs(amountMinor);
      const debtorMemberKey = amountMinor < 0 ? payer === "adam" ? "chelsea" : "adam" : payer as "adam" | "chelsea";
      const creditorMemberKey = debtorMemberKey === "adam" ? "chelsea" : "adam";
      // Keep the workbook's signed transfer. Do not replace it with the
      // calculated value when the two disagree.
      const recordedNetMinor = debtorMemberKey === "adam" ? -amount : amount;
      const transfer: LegacyTransfer = { sourceRow, date, amountMinor: amount, debtorMemberKey, creditorMemberKey, recordedNetMinor };
      transfers.push(transfer);
      const calculatedNetMinor = -currentNet;
      periods.push({ entryKeys: currentKeys, calculatedNetMinor, transfer });
      if (calculatedNetMinor !== recordedNetMinor) {
        errors.push(`row ${sourceRow}: calculated transfer ${calculatedNetMinor} does not match recorded transfer ${recordedNetMinor}`);
      }
      currentKeys = [];
      currentNet = 0;
      continue;
    }
    let counterpartyMinor: number;
    try {
      counterpartyMinor = Math.abs(parseMinor(split[splitCounterpartyAmount] ?? ""));
    } catch {
      errors.push(`row ${sourceRow}: invalid Split View counterparty amount`);
      continue;
    }
    if (counterpartyMinor > Math.abs(amountMinor)) {
      errors.push(`row ${sourceRow}: counterparty share exceeds total`);
      continue;
    }
    const total = Math.abs(amountMinor);
    const row: LegacyImportRow = { legacyKey: `sheet-2026:${sourceRow}`, sourceRow, kind: amountMinor >= 0 ? "expense" : "income", amountMinor: total, date, description, cashMemberKey: payer as "adam" | "chelsea", shares: payer === "adam" ? { adam: total - counterpartyMinor, chelsea: counterpartyMinor } : { adam: counterpartyMinor, chelsea: total - counterpartyMinor } };
    rows.push(row);
    currentKeys.push(row.legacyKey);
    currentNet += rowDebtForAdam(row);
  }
  // A trailing period with no Settle Up row is intentionally open. It still
  // belongs in the report so its entries can be imported, but has no transfer.
  if (currentKeys.length > 0) periods.push({ entryKeys: currentKeys, calculatedNetMinor: -currentNet });
  return { rows, transfers, periods, errors };
}

