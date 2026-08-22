import { describe, expect, it } from "vitest";
import { assertCurrencyMatch, formatMinorUnits, milliunitsToMinor, minorToMilliunits } from "./money";

describe("money conversions", () => {
  it("converts minor units using YNAB currency precision", () => {
    expect(minorToMilliunits(1889, 2)).toBe(18890);
    expect(milliunitsToMinor(18890, 2)).toBe(1889);
  });

  it("rejects milliunits that cannot represent a minor unit", () => {
    expect(() => milliunitsToMinor(18891, 2)).toThrow(/precision/i);
  });

  it("rejects unsupported decimal precision", () => {
    expect(() => minorToMilliunits(1, 4)).toThrow(/decimal/i);
  });
  it("formats configured currencies with exact precision and normalizes negative zero", () => {
    expect(formatMinorUnits(1889, { isoCode: "USD", decimalDigits: 2 })).toBe("$18.89");
    expect(formatMinorUnits(123, { isoCode: "JPY", decimalDigits: 0 })).toBe("¥123");
    expect(formatMinorUnits(-0, { isoCode: "USD", decimalDigits: 2 })).toBe("$0.00");
  });

  it("returns configuration state rather than fabricating a currency", () => {
    expect(formatMinorUnits(1, null)).toEqual({
      status: "configuration-required",
      message: "Configure a household currency before displaying amounts.",
    });
  });

  it("rejects unsafe amounts and invalid currency configuration", () => {
    expect(() => formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, { isoCode: "USD", decimalDigits: 2 })).toThrow(
      /safe integer/i,
    );
    expect(() => formatMinorUnits(1, { isoCode: "US", decimalDigits: 2 })).toThrow(/ISO/i);
    expect(() => formatMinorUnits(1, { isoCode: "USD", decimalDigits: 4 })).toThrow(/decimal/i);
  });

  it("rejects unsafe conversion amounts and every invalid precision shape", () => {
    expect(() => minorToMilliunits(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow(/safe integer/i);
    expect(() => milliunitsToMinor(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow(/safe integer/i);
    expect(() => minorToMilliunits(1, -1)).toThrow(/decimal/i);
    expect(() => milliunitsToMinor(1, 1.5)).toThrow(/decimal/i);
    expect(formatMinorUnits(1, undefined)).toMatchObject({ status: "configuration-required" });
  });
  it("rejects a converted milliunit result that is unsafe", () => {
    expect(() => minorToMilliunits(Number.MAX_SAFE_INTEGER, 2)).toThrow(/safe integer/i);
  });

  it("requires matching currency formats for linked plans", () => {
    const usd = { isoCode: "USD", decimalDigits: 2 };
    expect(() => assertCurrencyMatch(usd, usd)).not.toThrow();
    expect(() => assertCurrencyMatch(usd, { isoCode: "EUR", decimalDigits: 2 })).toThrow(/same currency/i);
    expect(() => assertCurrencyMatch(usd, { isoCode: "USD", decimalDigits: 0 })).toThrow(/same currency/i);
  });
});
