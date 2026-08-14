export interface CurrencyFormat {
  isoCode: string;
  decimalDigits: number;
}

function scaleFor(decimalDigits: number): number {
  if (!Number.isInteger(decimalDigits) || decimalDigits < 0 || decimalDigits > 3) {
    throw new RangeError("decimal digits must be an integer from 0 through 3");
  }
  return 10 ** (3 - decimalDigits);
}

export function minorToMilliunits(amountMinor: number, decimalDigits: number): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("minor amount must be a safe integer");
  return amountMinor * scaleFor(decimalDigits);
}

export function milliunitsToMinor(amountMilliunits: number, decimalDigits: number): number {
  if (!Number.isSafeInteger(amountMilliunits)) throw new RangeError("milliunit amount must be a safe integer");
  const scale = scaleFor(decimalDigits);
  if (amountMilliunits % scale !== 0) throw new RangeError("amount has unsupported precision");
  return amountMilliunits / scale;
}

export function assertCurrencyMatch(left: CurrencyFormat, right: CurrencyFormat): void {
  if (left.isoCode !== right.isoCode || left.decimalDigits !== right.decimalDigits) {
    throw new Error("linked YNAB plans must use the same currency format");
  }
}
