import { describe, expect, it } from "vitest";
import { signReviewedSnapshot, sourceSnapshotHash, verifyCreatedPosting, verifyReviewedSnapshotToken, verifySourceUpdate } from "./ynab-verification.server";

describe("YNAB source verification", () => {
  const source = { id: "t1", date: "2026-01-01", amount: -18890, account_id: "a1", payee_name: "Amazon", category_id: "groceries", approved: false, deleted: false, transfer_account_id: null, subtransactions: [] };
  it("hashes the reviewed immutable snapshot", () => {
    expect(sourceSnapshotHash(source)).toBe(sourceSnapshotHash({ ...source }));
    expect(sourceSnapshotHash(source)).not.toBe(sourceSnapshotHash({ ...source, amount: -18891 }));
  });
  it("reports stale source and accepts exact verified update", () => {
    expect(verifySourceUpdate(source, { ...source, amount: -18891 }, { category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] }).join(" ")).toMatch(/amount/);
    expect(verifySourceUpdate(source, { ...source, category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] }, { category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] })).toEqual([]);
  });
  it("checks import id and exact settlement read-back", () => {
    const target = { import_id: "YS:abc", account_id: "a1", date: "2026-01-02", amount: 3190, payee_name: "Chelsea", category_id: null, approved: true, subtransactions: [{ amount: -6250, category_id: "hospital", memo: "YS:e1" }, { amount: 9440, category_id: "splitting", memo: "YS:aggregate" }] };
    expect(verifyCreatedPosting(target, { ...target, subtransactions: target.subtransactions })).toEqual([]);
    expect(verifyCreatedPosting(target, { ...target, import_id: null }).join(" ")).toMatch(/import id/);
  });
  it("binds signed review tokens to user, plan, transaction, and expiry", () => {
    const claims = { userId: "u1", planId: "p1", transactionId: "t1", expiresAt: Math.floor(Date.now() / 1000) + 60, snapshot: source };
    const token = signReviewedSnapshot("test-secret", claims);
    expect(verifyReviewedSnapshotToken("test-secret", token, { userId: "u1", planId: "p1", transactionId: "t1" }).snapshot).toEqual(source);
    expect(() => verifyReviewedSnapshotToken("test-secret", token, { userId: "u2", planId: "p1", transactionId: "t1" })).toThrow(/invalid|expired|mismatch/i);
    expect(() => verifyReviewedSnapshotToken("wrong", token, { userId: "u1", planId: "p1", transactionId: "t1" })).toThrow(/invalid/i);
    const expired = signReviewedSnapshot("test-secret", { ...claims, expiresAt: Math.floor(Date.now() / 1000) + 1 });
    expect(() => verifyReviewedSnapshotToken("test-secret", expired, { userId: "u1", planId: "p1", transactionId: "t1" }, Math.floor(Date.now() / 1000) + 2)).toThrow(/invalid|expired/i);
  });
});
