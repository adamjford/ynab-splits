export interface CurrencyFormat {
  isoCode: string;
  decimalDigits: number;
}

export interface CurrencyConfigurationState {
  status: "configuration-required";
  message: "Configure a household currency before displaying amounts.";
}

export type FormattedMinorUnits = string | CurrencyConfigurationState;

function scaleFor(decimalDigits: number): number {
  if (!Number.isInteger(decimalDigits) || decimalDigits < 0 || decimalDigits > 3) {
    throw new RangeError("decimal digits must be an integer from 0 through 3");
  }
  return 10 ** (3 - decimalDigits);
}
export function formatMinorUnits(amountMinor: number, currency: CurrencyFormat | null | undefined): FormattedMinorUnits {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("minor amount must be a safe integer");
  if (!currency) return { status: "configuration-required", message: "Configure a household currency before displaying amounts." };
  const decimalDigits = currency.decimalDigits;
  scaleFor(decimalDigits);
  if (!/^[A-Z]{3}$/.test(currency.isoCode)) throw new RangeError("currency ISO code must be a three-letter uppercase code");
  const normalizedAmount = Object.is(amountMinor, -0) ? 0 : amountMinor;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.isoCode,
    minimumFractionDigits: decimalDigits,
    maximumFractionDigits: decimalDigits,
  }).format(normalizedAmount / 10 ** decimalDigits);
}

export function minorToMilliunits(amountMinor: number, decimalDigits: number): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("minor amount must be a safe integer");
  const milliunits = amountMinor * scaleFor(decimalDigits);
  if (!Number.isSafeInteger(milliunits)) throw new RangeError("milliunit amount must be a safe integer");
  return milliunits;
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
