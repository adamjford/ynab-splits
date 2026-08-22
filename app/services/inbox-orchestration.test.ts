import { describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "../db/database.server";
import type { YnabGateway, YnabTransaction } from "./ynab.server";
import { verifyManualSplitReadback } from "../domain/manual-split";
import { assertEntryEditable, correctLedgerEntry, dismissManualTask, editLedgerEntry, postingImportId, prepareManualTask, restoreNotSharedDecision, retrySourcePosting, reviewToken, saveInboxDecision, saveNotSharedDecision, verifyManualTask, voidLedgerEntry } from "./inbox-orchestration.server";

type TestUser = { id: string; householdId: string; memberKey: "adam" | "chelsea" };
const user: TestUser = { id: "u1", householdId: "h1", memberKey: "adam" };
const settings = { planId: "p1", currencyDecimalDigits: 2, splittingCategoryId: null };
const transaction: YnabTransaction = { id: "t1", date: "2026-01-01", amount: -18890, account_id: "a1", payee_name: "Amazon", category_id: "groceries", approved: false, deleted: false, transfer_account_id: null, subtransactions: [] };
const gateway: YnabGateway = {
  getUser: async () => ({ id: "y1" }),
  getPlans: async () => [],
  getAccounts: async () => [],
  getCategories: async () => [],
  getUnapprovedTransactions: async () => [],
  getTransaction: async () => transaction,
  findTransactionByImportId: async () => null,
  updateTransaction: async () => transaction,
  createTransaction: async () => transaction,
};

function setup(): AppDatabase {
  const db = createDatabase(":memory:");
  db.exec("insert into users (id, ynab_user_id, display_name) values ('u1', 'y1', 'Adam'), ('u2', 'y2', 'Chelsea'); insert into households (id, name) values ('h1', 'Home'); insert into memberships (household_id, user_id, member_key) values ('h1', 'u1', 'adam'), ('h1', 'u2', 'chelsea');");
  return db;
}
function insertDecision(db: AppDatabase, id = "d1", source: YnabTransaction = transaction): void {
  db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision, source_snapshot_hash, source_snapshot_json) values (?, 'u1', 'p1', ?, 'shared', 'hash', ?)").run(id, source.id, JSON.stringify(source));
}

function insertPosting(db: AppDatabase, id = "p1", status = "pending", source: YnabTransaction = transaction): void {
  insertDecision(db, "d1", source);
  db.prepare("insert into ynab_postings (id, decision_id, user_id, posting_kind, status, import_id, intended_target_json) values (?, 'd1', 'u1', 'source', ?, ?, ?)").run(id, status, `import-${id}`, JSON.stringify({ category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] }));
}

const splitTransaction: YnabTransaction = { ...transaction, subtransactions: [
  { id: "line1", amount: -9450, category_id: "groceries", payee_name: "Amazon", memo: "owner" },
  { id: "line2", amount: -9440, category_id: "splitting", payee_name: "Amazon", memo: "counterparty" },
] };

describe("inbox review orchestration", () => {
  it("requires an unexpired token bound to the reviewed user and source", async () => {
    vi.useFakeTimers();
    try {
      const db = setup();
      const token = reviewToken("review-secret", user, settings, transaction, 60);
      await expect(saveInboxDecision({ db, user, settings, gateway, transaction: { ...transaction, payee_name: "Changed" }, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/changed|review/i);
      await expect(saveInboxDecision({ db, user: { ...user, id: "u2", memberKey: "chelsea" }, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/invalid|expired|mismatch/i);
      await expect(saveInboxDecision({ db, user, settings: { ...settings, planId: "p2" }, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/invalid|expired|mismatch/i);
      vi.advanceTimersByTime(61_000);
      await expect(saveInboxDecision({ db, user, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/expired|invalid|mismatch/i);
      db.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists a not-shared decision transactionally and prevents duplicate review", async () => {
    const db = setup();
    const token = reviewToken("review-secret", user, settings, transaction, 60);
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).resolves.toEqual({ saved: true });
    expect(db.prepare("select decision from ynab_transaction_decisions").get()).toEqual({ decision: "not_shared" });
    const otherUser: TestUser = { id: "u2", householdId: "h1", memberKey: "chelsea" };
    const otherToken = reviewToken("review-secret", otherUser, settings, transaction, 60);
    await expect(saveInboxDecision({ db, user: otherUser, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: otherToken, reviewSecret: "review-secret" })).resolves.toEqual({ saved: true });
    expect(db.prepare("select count(*) as count from ynab_transaction_decisions").get()).toEqual({ count: 2 });
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/unique|reviewed/i);
    db.close();
  });
  it("commits local state before a remote timeout and classifies it as pending", async () => {
    const db = setup();
    const timeoutGateway: YnabGateway = { ...gateway, getTransaction: async () => { throw { kind: "timeout" }; } };
    const updateSettings = { ...settings, splittingCategoryId: "splitting" };
    const token = reviewToken("review-secret", user, updateSettings, transaction, 60);
    const result = await saveInboxDecision({ db, user, settings: updateSettings, gateway: timeoutGateway, transaction, decision: "shared", split: { type: "equal" }, updateYnab: true, categoryId: "groceries", reviewToken: token, reviewSecret: "review-secret" });
    expect(result).toMatchObject({ saved: true, remote: "pending" });
    expect(db.prepare("select status, last_error from ynab_postings").get()).toMatchObject({ status: "pending", last_error: expect.stringMatching(/pending|retry/i) });
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
    expect(postingImportId("00000000-0000-0000-0000-000000000001")).toMatch(/^YS:[A-Z2-7]+$/);
    db.close();
  });
  it("rejects missing review proof and ineligible deleted or transfer sources", async () => {
    const db = setup();
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null })).rejects.toThrow(/token/i);
    const token = reviewToken("review-secret", user, settings, transaction, 60);
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction: { ...transaction, deleted: true }, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/deleted|transfer/i);
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction: { ...transaction, transfer_account_id: "transfer" }, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/deleted|transfer/i);
    db.close();
  });
  it("commits shared ledger state without remote work when updating is disabled", async () => {
    const db = setup();
    const token = reviewToken("review-secret", user, settings, transaction, 60);
    const result = await saveInboxDecision({ db, user, settings, gateway, transaction, decision: "shared", split: { type: "exact", otherAmountMinor: 944 }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" });
    expect(result).toEqual({ saved: true });
    expect(db.prepare("select decision from ynab_transaction_decisions").get()).toEqual({ decision: "shared" });
    expect(db.prepare("select amount_minor from ledger_shares where member_key = 'chelsea'").get()).toEqual({ amount_minor: 944 });
    db.close();
  });
  it("rejects malformed source dates and blank payees before writing a ledger parent", async () => {
    const invalidTransactions: YnabTransaction[] = [
      { ...transaction, date: "2026-02-30" },
      { ...transaction, payee_name: "" },
    ];
    for (const invalidTransaction of invalidTransactions) {
      const db = setup();
      const token = reviewToken("review-secret", user, settings, invalidTransaction, 60);
      await expect(saveInboxDecision({ db, user, settings, gateway, transaction: invalidTransaction, decision: "shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/date and description/i);
      expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
      db.close();
    }
  });

  it("rejects malformed corrective dates and blank descriptions before replacement insert", () => {
    for (const invalidInput of [{ date: "2026-02-30", description: "corrected" }, { date: "2026-01-02", description: " " }]) {
      const db = setup();
      db.exec("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'x'); insert into ledger_shares values ('e1', 'adam', 50), ('e1', 'chelsea', 50);");
      expect(() => correctLedgerEntry(db, "h1", "e1", { amountMinor: 100, cashMemberKey: "adam", kind: "expense", ...invalidInput, shares: [{ memberKey: "adam", amountMinor: 50 }, { memberKey: "chelsea", amountMinor: 50 }] })).toThrow(/date and description/i);
      expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
      expect(db.prepare("select voided_at from ledger_entries where id = 'e1'").get()).toEqual({ voided_at: null });
      db.close();
    }
  });

  it("requires both actual and Splitting categories for a YNAB update", async () => {
    const db = setup();
    const token = reviewToken("review-secret", user, settings, transaction, 60);
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction, decision: "shared", split: { type: "equal" }, updateYnab: true, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/category/i);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 0 });
    db.close();
  });
  it("creates an owner-scoped manual task for an existing YNAB split", async () => {
    const db = setup();
    const splitTransaction: YnabTransaction = { ...transaction, subtransactions: [
      { id: "line1", amount: -9450, category_id: "groceries", payee_name: "Amazon", memo: "owner" },
      { id: "line2", amount: -9440, category_id: "splitting", payee_name: "Amazon", memo: "counterparty" },
    ] };
    const splitSettings = { ...settings, splittingCategoryId: "splitting" };
    const token = reviewToken("review-secret", user, splitSettings, splitTransaction, 60);
    const result = await saveInboxDecision({ db, user, settings: splitSettings, gateway, transaction: splitTransaction, decision: "shared", split: { type: "exact", otherAmountMinor: 944 }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" });
    expect(result).toMatchObject({ saved: true, manualTaskId: expect.any(String) });
    expect(db.prepare("select status from manual_ynab_tasks").get()).toEqual({ status: "action_needed" });
    db.close();
  });
  it("restores only the owner's reversible not-shared decision", async () => {
    const db = setup();
    const token = reviewToken("review-secret", user, settings, transaction, 60);
    await saveInboxDecision({ db, user, settings, gateway, transaction, decision: "not_shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" });
    const decision = db.prepare("select id from ynab_transaction_decisions").get() as { id: string };
    restoreNotSharedDecision(db, user.id, decision.id);
    expect(db.prepare("select count(*) as count from ynab_transaction_decisions").get()).toEqual({ count: 0 });
    expect(() => restoreNotSharedDecision(db, user.id, decision.id)).toThrow(/not-shared|restored/i);
    expect(() => assertEntryEditable(db, "missing", user.householdId)).toThrow(/not found/i);
    db.close();
  });
  it("allows only transactional edits before voiding and blocks edits afterward", () => {
    const db = setup();
    db.exec("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'x'); insert into ledger_shares values ('e1', 'adam', 50), ('e1', 'chelsea', 50);");
    expect(() => assertEntryEditable(db, "e1", "h1")).not.toThrow();
    expect(() => editLedgerEntry(db, "e1", "h1", { description: " " })).toThrow(/empty/i);
    expect(db.prepare("select description from ledger_entries where id = 'e1'").get()).toEqual({ description: "x" });
    editLedgerEntry(db, "e1", "h1", { description: "edited" });
    editLedgerEntry(db, "e1", "h1", { categoryId: "cat" });
    expect(db.prepare("select description from ledger_entries where id = 'e1'").get()).toEqual({ description: "edited" });
    voidLedgerEntry(db, "e1", "h1");
    expect(db.prepare("select voided_at from ledger_entries where id = 'e1'").get()).toMatchObject({ voided_at: expect.any(String) });
    expect(() => assertEntryEditable(db, "e1", "h1")).toThrow(/voided/i);
    db.close();
  });

  it("creates a linked corrective entry and voids the original atomically", () => {
    const db = setup();
    db.exec("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'x'); insert into ledger_shares values ('e1', 'adam', 50), ('e1', 'chelsea', 50);");
    const replacement = correctLedgerEntry(db, "h1", "e1", { amountMinor: 120, cashMemberKey: "adam", kind: "expense", date: "2026-01-02", description: "corrected", shares: [{ memberKey: "adam", amountMinor: 60 }, { memberKey: "chelsea", amountMinor: 60 }] });
    expect(db.prepare("select correction_of_id, amount_minor from ledger_entries where id = ?").get(replacement)).toEqual({ correction_of_id: "e1", amount_minor: 120 });
    expect(db.prepare("select voided_at from ledger_entries where id = 'e1'").get()).toMatchObject({ voided_at: expect.any(String) });
    db.close();
  });
  it("rejects corrective cash-member mismatches and unsafe share sums", () => {
    const db = setup();
    db.exec("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'x'); insert into ledger_shares values ('e1', 'adam', 50), ('e1', 'chelsea', 50);");
    const mismatchedShares = [{ memberKey: "chelsea", amountMinor: 50 }, { memberKey: "other", amountMinor: 50 }] as unknown as Parameters<typeof correctLedgerEntry>[3]["shares"];
    expect(() => correctLedgerEntry(db, "h1", "e1", { amountMinor: 100, cashMemberKey: "adam", kind: "expense", date: "2026-01-02", description: "corrected", shares: mismatchedShares })).toThrow(/member|share/i);
    expect(() => correctLedgerEntry(db, "h1", "e1", { amountMinor: Number.MAX_SAFE_INTEGER, cashMemberKey: "adam", kind: "expense", date: "2026-01-02", description: "corrected", shares: [{ memberKey: "adam", amountMinor: Number.MAX_SAFE_INTEGER }, { memberKey: "chelsea", amountMinor: 1 }] })).toThrow(/shares/i);
    expect(db.prepare("select count(*) as count from ledger_entries").get()).toEqual({ count: 1 });
    db.close();
  });
  it("classifies every source update outcome without losing local state", async () => {
    const updateSettings = { ...settings, splittingCategoryId: "splitting" };
    const updated: YnabTransaction = { ...transaction, category_id: null, approved: true, subtransactions: [
      { amount: -9450, category_id: "groceries" },
      { amount: -9440, category_id: "splitting" },
    ] };
    const cases: Array<{ name: string; gateway: YnabGateway; expected: string }> = [
      { name: "success", gateway: { ...gateway, getTransaction: async () => transaction, updateTransaction: async () => updated }, expected: "succeeded" },
      { name: "already applied", gateway: { ...gateway, getTransaction: async () => updated, updateTransaction: async () => { throw new Error("must not update"); } }, expected: "succeeded" },
      { name: "stale conflict", gateway: { ...gateway, getTransaction: async () => ({ ...transaction, payee_name: "Someone else" }) }, expected: "conflict" },
      { name: "readback conflict", gateway: { ...gateway, getTransaction: async () => transaction, updateTransaction: async () => ({ ...updated, approved: false }) }, expected: "conflict" },
      { name: "unauthorized", gateway: { ...gateway, getTransaction: async () => { throw { kind: "unauthorized" }; } }, expected: "failed" },
      { name: "rate limited", gateway: { ...gateway, getTransaction: async () => { throw { kind: "rate_limit" }; } }, expected: "failed" },
      { name: "network pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "network" }; } }, expected: "pending" },
    ];
    for (const testCase of cases) {
      const db = setup();
      const token = reviewToken("review-secret", user, updateSettings, transaction, 60);
      const result = await saveInboxDecision({ db, user, settings: updateSettings, gateway: testCase.gateway, transaction, decision: "shared", split: { type: "exact", otherAmountMinor: 944 }, updateYnab: true, categoryId: "groceries", reviewToken: token, reviewSecret: "review-secret" });
      expect(result.remote, testCase.name).toBe(testCase.expected);
      db.close();
    }
  });

  it("rejects existing splits without a configured splitting category", async () => {
    const db = setup();
    const token = reviewToken("review-secret", user, settings, splitTransaction, 60);
    await expect(saveInboxDecision({ db, user, settings, gateway, transaction: splitTransaction, decision: "shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/Splitting category/i);
    db.close();
  });

  it("verifies, dismisses, and prepares owner-scoped manual tasks", async () => {
    const target = { parentId: "t1", parentAmountMinor: -1889, accountId: "a1", date: "2026-01-01", payeeName: "Amazon", approved: true as const, lines: [
      { categoryId: "groceries", amountMinor: -945, payeeName: "Amazon", memo: "owner" },
      { categoryId: "splitting", amountMinor: -944, payeeName: "Amazon", memo: "counterparty" },
    ] };
    const remote: YnabTransaction = { ...splitTransaction, approved: true, subtransactions: [
      { id: "line1", amount: -9450, category_id: "groceries", payee_name: "Amazon", memo: "owner" },
      { id: "line2", amount: -9440, category_id: "splitting", payee_name: "Amazon", memo: "counterparty" },
    ] };
    const db = setup();
    insertDecision(db);
    db.prepare("insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values ('m1', 'd1', 'action_needed', ?)").run(JSON.stringify(target));
    expect(verifyManualSplitReadback({ id: remote.id, amountMinor: remote.amount / 10, accountId: remote.account_id, date: remote.date, payeeName: remote.payee_name, approved: remote.approved, subtransactions: remote.subtransactions.map((line) => ({ categoryId: line.category_id, amountMinor: line.amount / 10, payeeName: line.payee_name, memo: line.memo })) }, target)).toEqual({ matches: true, differences: [] });
    expect(await verifyManualTask(db, "u2", "m1", gateway, 2)).toMatchObject({ verified: false, error: expect.stringMatching(/not actionable|owned/i) });
    expect(() => dismissManualTask(db, "u2", "m1")).toThrow(/not found|owned|resolved/i);
    const verification = await verifyManualTask(db, user.id, "m1", { ...gateway, getTransaction: async () => remote }, 2);
    expect(verification).toEqual({ verified: true });
    expect(() => dismissManualTask(db, user.id, "m1")).toThrow(/already resolved/i);
    db.prepare("update manual_ynab_tasks set status = 'action_needed' where id = 'm1'").run();
    dismissManualTask(db, user.id, "m1");
    expect(db.prepare("select status from manual_ynab_tasks where id = 'm1'").get()).toEqual({ status: "dismissed" });
    db.prepare("update manual_ynab_tasks set status = 'action_needed' where id = 'm1'").run();
    prepareManualTask(db, user.id, "m1", "splitting", ["groceries"], [-945]);
    expect(JSON.parse((db.prepare("select intended_target_json from manual_ynab_tasks where id = 'm1'").get() as { intended_target_json: string }).intended_target_json).lines).toHaveLength(2);
    db.prepare("update manual_ynab_tasks set intended_target_json = ?, status = 'action_needed' where id = 'm1'").run(JSON.stringify({
      parentAmountMinor: -1889, accountId: "a1", date: "2026-01-01", approved: true,
      lines: [{ categoryId: "groceries", amountMinor: -945 }, { categoryId: "splitting", amountMinor: -944 }],
    }));
    prepareManualTask(db, user.id, "m1", "splitting", ["groceries"], [-945]);
    expect(await verifyManualTask(db, user.id, "missing", gateway, 2)).toMatchObject({ verified: false, error: expect.stringMatching(/not actionable|owned/i) });
    expect(() => prepareManualTask(db, user.id, "missing", "splitting", ["groceries"], [-945])).toThrow(/not actionable|owned/i);
    expect(() => prepareManualTask(db, user.id, "m1", null, ["groceries"], [-945])).toThrow(/Splitting/i);
    expect(() => prepareManualTask(db, user.id, "m1", "splitting", [], [])).toThrow(/integer amount/i);
    db.close();
  });
  it("records manual verification mismatches and transport failures", async () => {
    const target = { parentId: "t1", parentAmountMinor: -1889, accountId: "a1", date: "2026-01-01", payeeName: "Amazon", approved: true as const, lines: [{ categoryId: "groceries", amountMinor: -945 }, { categoryId: "splitting", amountMinor: -944 }] };
    for (const remote of [{ ...splitTransaction, payee_name: "Wrong" }, null]) {
      const db = setup();
      insertDecision(db);
      db.prepare("insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values ('m1', 'd1', 'action_needed', ?)").run(JSON.stringify(target));
      const taskGateway = remote ? { ...gateway, getTransaction: async () => remote } : { ...gateway, getTransaction: async () => { throw new Error("offline"); } };
      const result = await verifyManualTask(db, user.id, "m1", taskGateway, 2);
      expect(result).toMatchObject({ verified: false });
      if (remote) expect(db.prepare("select status from manual_ynab_tasks where id = 'm1'").get()).toEqual({ status: "action_needed" });
      if (remote) expect(db.prepare("select last_error from manual_ynab_tasks where id = 'm1'").get()).toMatchObject({ last_error: expect.any(String) });
      db.close();
    }
  });

  it("retries source postings through terminal, conflict, success, and failure states", async () => {
    const updated: YnabTransaction = { ...transaction, category_id: null, approved: true, subtransactions: [{ amount: -9450, category_id: "groceries" }, { amount: -9440, category_id: "splitting" }] };
    const scenarios: Array<{ status: string; gateway: YnabGateway; expected: string }> = [
      { status: "succeeded", gateway, expected: "succeeded" },
      { status: "skipped", gateway, expected: "skipped" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "network" }; } }, expected: "pending" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => ({ ...transaction, payee_name: "changed" }) }, expected: "conflict" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => updated }, expected: "succeeded" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => transaction, updateTransaction: async () => updated }, expected: "succeeded" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => transaction, updateTransaction: async () => ({ ...updated, approved: false }) }, expected: "conflict" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "unauthorized" }; } }, expected: "failed" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "rate_limit" }; } }, expected: "failed" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "malformed" }; } }, expected: "failed" },
      { status: "pending", gateway: { ...gateway, getTransaction: async () => { throw { kind: "timeout" }; } }, expected: "pending" },
    ];
    for (const scenario of scenarios) {
      const db = setup();
      insertPosting(db, "p1", scenario.status);
      const result = await retrySourcePosting(db, user.id, "p1", scenario.gateway);
      expect(result.status).toBe(scenario.expected);
      db.close();
    }
    const db = setup();
    expect(await retrySourcePosting(db, user.id, "missing", gateway)).toMatchObject({ status: "missing" });
    insertPosting(db, "p2", "pending");
    expect(await retrySourcePosting(db, "u2", "p2", gateway)).toMatchObject({ status: "missing" });
    db.prepare("update ynab_transaction_decisions set source_snapshot_json = null where id = 'd1'").run();
    expect(await retrySourcePosting(db, user.id, "p2", gateway)).toMatchObject({ status: "conflict" });
    db.close();
  });

  it("rejects unsafe correction and settlement-linked edits", () => {
    const db = setup();
    db.exec("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description) values ('e1', 'h1', 'expense', 100, 'adam', '2026-01-01', 'x'); insert into ledger_shares values ('e1', 'adam', 50), ('e1', 'chelsea', 50); insert into settlements (id, household_id, start_date, end_date, debtor_member_key, creditor_member_key, amount_minor, status) values ('s1', 'h1', '2026-01-01', '2026-01-02', 'adam', 'chelsea', 50, 'open'); insert into settlement_items (settlement_id, ledger_entry_id) values ('s1', 'e1');");
    expect(() => assertEntryEditable(db, "e1", "h1")).toThrow(/settled/i);
    expect(() => correctLedgerEntry(db, "h1", "e1", { amountMinor: 100, cashMemberKey: "adam", kind: "expense", date: "2026-01-02", description: "bad", shares: [{ memberKey: "adam", amountMinor: 100 }, { memberKey: "adam", amountMinor: 0 }] })).toThrow(/shares/i);
    db.close();
  });
  it("covers income, alternate member, fallback payee, and retry error classification", async () => {
    const db = setup();
    const otherUser: TestUser = { id: "u2", householdId: "h1", memberKey: "chelsea" };
    const income: YnabTransaction = { ...transaction, id: "income", amount: 18890, payee_name: null };
    const incomeSettings = { ...settings, splittingCategoryId: "splitting" };
    const updated: YnabTransaction = { ...income, category_id: null, approved: true, subtransactions: [
      { amount: 9450, category_id: "groceries" },
      { amount: 9440, category_id: "splitting" },
    ] };
    const token = reviewToken("review-secret", otherUser, incomeSettings, income, 60);
    const result = await saveInboxDecision({ db, user: otherUser, settings: incomeSettings, gateway: { ...gateway, getTransaction: async () => income, updateTransaction: async () => updated }, transaction: income, decision: "shared", split: { type: "equal" }, updateYnab: true, categoryId: "groceries", reviewToken: token, reviewSecret: "review-secret" });
    expect(result.remote).toBe("succeeded");
    expect(db.prepare("select kind, description from ledger_entries").get()).toEqual({ kind: "income", description: "YNAB transaction" });
    await expect(saveInboxDecision({ db, user: otherUser, settings: incomeSettings, gateway, transaction: income, decision: "shared", split: { type: "equal" }, updateYnab: false, categoryId: null, reviewToken: token, reviewSecret: "review-secret" })).rejects.toThrow(/reviewed/i);
    insertPosting(db, "generic", "pending", transaction);
    expect((await retrySourcePosting(db, user.id, "generic", { ...gateway, getTransaction: async () => { throw new Error("offline"); } })).status).toBe("failed");
    expect(() => saveNotSharedDecision(db, user.id === "u2" ? otherUser : user, incomeSettings, { ...income, deleted: true }, token, "review-secret")).toThrow(/Transfers|deleted/i);
    db.close();
  });

});
