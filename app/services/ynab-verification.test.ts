import { describe, expect, it } from "vitest";
import { signReviewedSnapshot, sourceSnapshotHash, verifyCreatedPosting, verifyReviewedSnapshotToken, verifyReviewedSource, verifySourceUpdate } from "./ynab-verification.server";
import type { CreatedPostingTarget, ReviewedSource, SourceUpdateTarget } from "./ynab-verification.server";

describe("YNAB source verification", () => {
  const source: ReviewedSource = { id: "t1", date: "2026-01-01", amount: -18890, account_id: "a1", payee_name: "Amazon", category_id: "groceries", approved: false, deleted: false, transfer_account_id: null, subtransactions: [] };
  it("hashes the reviewed immutable snapshot", () => {
    expect(sourceSnapshotHash(source)).toBe(sourceSnapshotHash({ ...source }));
    expect(sourceSnapshotHash(source)).not.toBe(sourceSnapshotHash({ ...source, amount: -18891 }));
  });
  it("reports every reviewed source field that changed before an update", () => {
    const cases: Array<{ change: Partial<typeof source>; expected: RegExp }> = [
      { change: { id: "t2" }, expected: /id/ },
      { change: { date: "2026-01-02" }, expected: /date/ },
      { change: { amount: -18891 }, expected: /amount/ },
      { change: { account_id: "a2" }, expected: /account/ },
      { change: { payee_name: "Someone else" }, expected: /payee/ },
      { change: { category_id: "other" }, expected: /category/ },
      { change: { approved: true }, expected: /approval/ },
      { change: { deleted: true }, expected: /deletion/ },
      { change: { transfer_account_id: "transfer" }, expected: /transfer/ },
      { change: { subtransactions: [{ amount: -18890, category_id: "groceries" }] }, expected: /subtransactions/ },
    ];
    for (const testCase of cases) {
      expect(verifyReviewedSource(source, { ...source, ...testCase.change }).join(" ")).toMatch(testCase.expected);
    }
  });

  it("distinguishes parent and target read-back fields", () => {
    const target: SourceUpdateTarget = { category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] };
    const updated: ReviewedSource = { ...source, category_id: null, approved: true, subtransactions: target.subtransactions };
    expect(verifySourceUpdate(source, updated, target)).toEqual([]);
    const cases: Array<{ remote: typeof updated; expected: RegExp }> = [
      { remote: { ...updated, id: "t2" }, expected: /id/ },
      { remote: { ...updated, date: "2026-01-02" }, expected: /date/ },
      { remote: { ...updated, amount: -18891 }, expected: /amount/ },
      { remote: { ...updated, account_id: "a2" }, expected: /account/ },
      { remote: { ...updated, payee_name: "Someone else" }, expected: /payee/ },
      { remote: { ...updated, category_id: "other" }, expected: /category/ },
      { remote: { ...updated, approved: false }, expected: /approved/ },
      { remote: { ...updated, subtransactions: [{ amount: -18890, category_id: "other" }] }, expected: /subtransactions/ },
    ];
    for (const testCase of cases) {
      expect(verifySourceUpdate(source, testCase.remote, target).join(" ")).toMatch(testCase.expected);
    }
  });

  it("reports stale source and accepts exact verified update", () => {
    expect(verifySourceUpdate(source, { ...source, amount: -18891 }, { category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] }).join(" ")).toMatch(/amount/);
    expect(verifySourceUpdate(source, { ...source, category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] }, { category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] })).toEqual([]);
  });
  it("checks import id and exact settlement read-back", () => {
    const target: CreatedPostingTarget = { import_id: "YS:abc", account_id: "a1", date: "2026-01-02", amount: 3190, payee_name: "Chelsea", category_id: null, approved: true, subtransactions: [{ amount: -6250, category_id: "hospital", memo: "YS:e1" }, { amount: 9440, category_id: "splitting", memo: "YS:aggregate" }] };
    expect(verifyCreatedPosting(target, { ...target, subtransactions: target.subtransactions })).toEqual([]);
    expect(verifyCreatedPosting(target, { ...target, import_id: null }).join(" ")).toMatch(/import id/);
    const mismatches: Array<{ remote: typeof target; expected: RegExp }> = [
      { remote: { ...target, account_id: "a2" }, expected: /account/ },
      { remote: { ...target, date: "2026-01-03" }, expected: /date/ },
      { remote: { ...target, amount: 3191 }, expected: /amount/ },
      { remote: { ...target, payee_name: "Adam" }, expected: /payee/ },
      { remote: { ...target, category_id: "other" }, expected: /category/ },
      { remote: { ...target, approved: false }, expected: /approved/ },
      { remote: { ...target, subtransactions: [{ ...target.subtransactions[0], amount: -6251 }, target.subtransactions[1]] }, expected: /subtransactions/ },
    ];
    for (const mismatch of mismatches) {
      expect(verifyCreatedPosting(target, mismatch.remote).join(" ")).toMatch(mismatch.expected);
    }
    expect(verifyCreatedPosting(target, { ...target, subtransactions: [...target.subtransactions].reverse() })).toEqual([]);
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
