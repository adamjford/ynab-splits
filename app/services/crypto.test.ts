import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signValue, verifyValue } from "./crypto.server";

describe("crypto helpers", () => {
  const key = "01234567890123456789012345678901";

  it("round-trips encrypted secrets and uses non-deterministic ciphertext", () => {
    const first = encryptSecret("refresh-token", key);
    const second = encryptSecret("refresh-token", key);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, key)).toBe("refresh-token");
  });

  it("rejects tampered signed values", () => {
    const signed = signValue({ userId: "u1" }, "secret");
    expect(verifyValue(signed, "secret")).toEqual({ userId: "u1" });
    expect(() => verifyValue(`${signed}x`, "secret")).toThrow(/signature/i);
  });
});
