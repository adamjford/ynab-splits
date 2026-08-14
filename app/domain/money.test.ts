import { describe, expect, it } from "vitest";
import { minorToMilliunits, milliunitsToMinor } from "./money";

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
});
