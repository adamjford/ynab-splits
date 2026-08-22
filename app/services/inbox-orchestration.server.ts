import { randomUUID } from "node:crypto";
import { withLedgerTransaction, type AppDatabase } from "~/db/database.server";
import { assertLedgerEntry, allocateShares, type SplitInput } from "~/domain/ledger";
import { milliunitsToMinor, minorToMilliunits } from "~/domain/money";
import { buildManualSplitTarget, verifyManualSplitReadback, type ManualSourceTransaction, type ManualSplitTarget, type OwnerAllocation } from "~/domain/manual-split";
import { sourceSnapshotHash, verifyReviewedSource, verifySourceUpdate, type ReviewedSource, type SourceUpdateTarget, signReviewedSnapshot, verifyReviewedSnapshotToken } from "~/services/ynab-verification.server";
import type { YnabGateway, YnabTransaction } from "~/services/ynab.server";

export interface InboxUser { id: string; householdId: string; memberKey: "adam" | "chelsea"; }
export interface InboxSettings { planId: string; currencyDecimalDigits: number; splittingCategoryId: string | null; }
export interface ReviewedTransactionBinding { userId: string; planId: string; transactionId: string; }
export interface SaveInboxInput {
  db: AppDatabase;
  user: InboxUser;
  settings: InboxSettings;
  gateway: YnabGateway;
  transaction: YnabTransaction;
  decision: "shared" | "not_shared";
  split: SplitInput;
  updateYnab: boolean;
  categoryId: string | null;
  reviewToken?: string;
  reviewSecret?: string;
}

function otherMember(memberKey: "adam" | "chelsea"): "adam" | "chelsea" {
  return memberKey === "adam" ? "chelsea" : "adam";
}

function safeError(error: unknown): string {
  if (error && typeof error === "object" && "kind" in error) {
    const kind = String((error as { kind?: unknown }).kind);
    if (kind === "timeout" || kind === "network") return "YNAB update is pending; retry after checking YNAB.";
    if (kind === "unauthorized") return "YNAB authentication expired.";
    if (kind === "rate_limit") return "YNAB rate limit reached; retry later.";
  }
  return "YNAB update failed; retry from the ledger entry.";
}

function isIndeterminate(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "kind" in error && ["timeout", "network"].includes(String((error as { kind?: unknown }).kind)));
}

function base32Id(id: string): string {
  const bytes = Buffer.from(id.replaceAll("-", ""), "hex");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function postingImportId(postingId: string): string {
  return `YS:${base32Id(postingId)}`.slice(0, 36);
}

export function reviewToken(secret: string, user: InboxUser, settings: InboxSettings, transaction: ReviewedSource, ttlSeconds = 300): string {
  return signReviewedSnapshot(secret, { userId: user.id, planId: settings.planId, transactionId: transaction.id, expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds, snapshot: transaction });
}

export function assertReviewedTransaction(secret: string, token: string, binding: ReviewedTransactionBinding, current: ReviewedSource): ReviewedSource {
  const claims = verifyReviewedSnapshotToken(secret, token, binding);
  const differences = verifyReviewedSource(claims.snapshot, current);
  if (differences.length > 0) throw new Error("The reviewed transaction changed; refresh the inbox before saving.");
  return claims.snapshot;
}

function sourceForManual(transaction: YnabTransaction, decimalDigits: number): ManualSourceTransaction {
  return {
    id: transaction.id,
    date: transaction.date,
    amountMinor: milliunitsToMinor(transaction.amount, decimalDigits),
    accountId: transaction.account_id,
    payeeName: transaction.payee_name,
    approved: transaction.approved,
    subtransactions: transaction.subtransactions.map((line) => ({ id: line.id, categoryId: line.category_id, amountMinor: milliunitsToMinor(line.amount, decimalDigits), payeeName: line.payee_name, memo: line.memo })),
  };
}

function buildTarget(transaction: YnabTransaction, settings: InboxSettings, signedShares: Array<{ amountMinor: number }>, categoryId: string | null, updateYnab: boolean): SourceUpdateTarget | null {
  if (!updateYnab || transaction.subtransactions.length > 0) return null;
  if (!categoryId || !settings.splittingCategoryId) throw new Error("Choose an actual category and Splitting category before updating YNAB.");
  const sign = transaction.amount < 0 ? -1 : 1;
  return {
    category_id: null,
    approved: true,
    subtransactions: signedShares.map((share, index) => ({ amount: minorToMilliunits(share.amountMinor * sign, settings.currencyDecimalDigits), category_id: index === 0 ? categoryId : settings.splittingCategoryId })),
  };
}

function insertSourcePosting(db: AppDatabase, postingId: string, decisionId: string, userId: string, target: SourceUpdateTarget): void {
  db.prepare("insert into ynab_postings (id, decision_id, user_id, posting_kind, status, import_id, intended_target_json) values (?, ?, ?, 'source', 'pending', ?, ?)").run(postingId, decisionId, userId, postingImportId(postingId), JSON.stringify(target));
}

function updatePosting(db: AppDatabase, postingId: string, status: "pending" | "succeeded" | "failed" | "conflict", fields: { error?: string | null; remote?: YnabTransaction | null } = {}): void {
  withLedgerTransaction(db, () => {
    db.prepare("update ynab_postings set status = ?, last_error = ?, remote_transaction_id = ?, remote_readback_json = ?, updated_at = CURRENT_TIMESTAMP where id = ?").run(status, fields.error ?? null, fields.remote?.id ?? null, fields.remote ? JSON.stringify(fields.remote) : null, postingId);
  });
}

async function updateSourceRemote(db: AppDatabase, gateway: YnabGateway, planId: string, transaction: YnabTransaction, snapshot: ReviewedSource, postingId: string, target: SourceUpdateTarget): Promise<{ status: "succeeded" | "failed" | "conflict" | "pending"; message?: string }> {
  try {
    const before = await gateway.getTransaction(planId, transaction.id);
    const stale = verifyReviewedSource(snapshot, before);
    if (stale.length > 0) {
      const alreadyApplied = verifySourceUpdate(snapshot, before, target);
      if (alreadyApplied.length === 0) {
        updatePosting(db, postingId, "succeeded", { remote: before });
        return { status: "succeeded" };
      }
      updatePosting(db, postingId, "conflict", { error: "YNAB source changed since review.", remote: before });
      return { status: "conflict", message: "YNAB source changed since review; refresh before updating." };
    }
    const readback = await gateway.updateTransaction(planId, transaction.id, target as unknown as Record<string, unknown>);
    const differences = verifySourceUpdate(snapshot, readback, target);
    if (differences.length > 0) {
      updatePosting(db, postingId, "conflict", { error: "YNAB read-back did not match the requested update.", remote: readback });
      return { status: "conflict", message: "YNAB read-back did not match the requested update." };
    }
    updatePosting(db, postingId, "succeeded", { remote: readback });
    return { status: "succeeded" };
  } catch (error) {
    const pending = isIndeterminate(error);
    updatePosting(db, postingId, pending ? "pending" : "failed", { error: safeError(error) });
    return { status: pending ? "pending" : "failed", message: safeError(error) };
  }
}

export async function saveInboxDecision(input: SaveInboxInput): Promise<{ saved: true; postingId?: string; manualTaskId?: string; remote?: "succeeded" | "failed" | "conflict" | "pending"; error?: string }> {
  const { db, user, settings, gateway, transaction } = input;
  if (transaction.deleted || transaction.transfer_account_id) throw new Error("Transfers and deleted transactions cannot be saved from the inbox.");
  if (input.reviewToken && input.reviewSecret) assertReviewedTransaction(input.reviewSecret, input.reviewToken, { userId: user.id, planId: settings.planId, transactionId: transaction.id }, transaction);
  else throw new Error("A reviewed transaction token is required.");
  if (input.decision === "not_shared") {
    saveNotSharedDecision(db, user, settings, transaction, input.reviewToken as string, input.reviewSecret as string);
    return { saved: true };
  }
  const parentMinor = milliunitsToMinor(transaction.amount, settings.currencyDecimalDigits);
  const totalMinor = Math.abs(parentMinor);
  const shares = allocateShares(totalMinor, user.memberKey, otherMember(user.memberKey), input.split);
  const signedShares = shares.map((share) => ({ memberKey: share.memberId, amountMinor: share.amountMinor }));
  const updateTarget = buildTarget(transaction, settings, signedShares, input.categoryId, input.updateYnab);
  let manualTarget: ManualSplitTarget | null = null;
  if (transaction.subtransactions.length > 0) {
    if (!settings.splittingCategoryId) throw new Error("Configure the Splitting category before saving an existing split.");
    const source = sourceForManual(transaction, settings.currencyDecimalDigits);
    const ownerAllocations: OwnerAllocation[] = source.subtransactions.filter((line) => line.categoryId && line.categoryId !== settings.splittingCategoryId).map((line) => ({ categoryId: line.categoryId as string, amountMinor: line.amountMinor, payeeName: line.payeeName, memo: line.memo }));
    const ownerShare = signedShares.find((share) => share.memberKey === user.memberKey)?.amountMinor ?? 0;
    manualTarget = { ...buildManualSplitTarget(source, parentMinor < 0 ? -ownerShare : ownerShare, ownerAllocations, settings.splittingCategoryId), parentId: transaction.id };
  }
  const entryId = randomUUID();
  const kind = parentMinor < 0 ? "expense" : "income";
  const description = transaction.payee_name ?? "YNAB transaction";
  assertLedgerEntry({ id: entryId, kind, amountMinor: totalMinor, cashMemberId: user.memberKey, shares, date: transaction.date, description });
  const decisionId = randomUUID();
  const postingId = updateTarget ? randomUUID() : null;
  const manualTaskId = manualTarget ? randomUUID() : null;
  const hash = sourceSnapshotHash(transaction);
  withLedgerTransaction(db, () => {
    const duplicate = db.prepare("select id from ynab_transaction_decisions where user_id = ? and plan_id = ? and ynab_transaction_id = ?").get(user.id, settings.planId, transaction.id);
    if (duplicate) throw new Error("This transaction has already been reviewed.");
    db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id, source_plan_id, source_transaction_id, source_snapshot_hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(entryId, user.householdId, kind, totalMinor, user.memberKey, transaction.date, description, transaction.category_id, settings.planId, transaction.id, hash);
    const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
    for (const share of signedShares) insertShare.run(entryId, share.memberKey, share.amountMinor);
    db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision, ledger_entry_id, source_snapshot_hash, source_snapshot_json) values (?, ?, ?, ?, 'shared', ?, ?, ?)").run(decisionId, user.id, settings.planId, transaction.id, entryId, hash, JSON.stringify(transaction));
    if (postingId && updateTarget) insertSourcePosting(db, postingId, decisionId, user.id, updateTarget);
    if (manualTaskId && manualTarget) db.prepare("insert into manual_ynab_tasks (id, decision_id, status, intended_target_json) values (?, ?, 'action_needed', ?)").run(manualTaskId, decisionId, JSON.stringify(manualTarget));
  });
  if (!postingId || !updateTarget) return { saved: true, manualTaskId: manualTaskId ?? undefined };
  const remote = await updateSourceRemote(db, gateway, settings.planId, transaction, transaction, postingId, updateTarget);
  return { saved: true, postingId, remote: remote.status, error: remote.message };
}

export function saveNotSharedDecision(db: AppDatabase, user: InboxUser, settings: InboxSettings, transaction: ReviewedSource, reviewTokenValue: string, reviewSecret: string): void {
  if (transaction.deleted || transaction.transfer_account_id) throw new Error("Transfers and deleted transactions cannot be dismissed from the inbox.");
  assertReviewedTransaction(reviewSecret, reviewTokenValue, { userId: user.id, planId: settings.planId, transactionId: transaction.id }, transaction);
  withLedgerTransaction(db, () => {
    db.prepare("insert into ynab_transaction_decisions (id, user_id, plan_id, ynab_transaction_id, decision, source_snapshot_hash, source_snapshot_json) values (?, ?, ?, ?, 'not_shared', ?, ?)").run(randomUUID(), user.id, settings.planId, transaction.id, sourceSnapshotHash(transaction), JSON.stringify(transaction));
  });
}

export function restoreNotSharedDecision(db: AppDatabase, userId: string, decisionId: string): void {
  withLedgerTransaction(db, () => {
    const result = db.prepare("delete from ynab_transaction_decisions where id = ? and user_id = ? and decision = 'not_shared'").run(decisionId, userId);
    if (result.changes !== 1) throw new Error("Not-shared decision not found or already restored.");
  });
}

export function assertEntryEditable(db: AppDatabase, entryId: string, householdId: string): void {
  const entry = db.prepare("select voided_at from ledger_entries where id = ? and household_id = ?").get(entryId, householdId) as { voided_at: string | null } | undefined;
  if (!entry) throw new Error("Ledger entry not found.");
  const settlement = db.prepare("select 1 from settlement_items si join settlements s on s.id = si.settlement_id where si.ledger_entry_id = ? and si.unlinked_at is null and s.status <> 'voided' limit 1").get(entryId);
  if (settlement) throw new Error("Settled entries must be corrected only after voiding the settlement.");
  if (entry.voided_at) throw new Error("Voided entries cannot be edited.");
}

export function voidLedgerEntry(db: AppDatabase, entryId: string, householdId: string): void {
  withLedgerTransaction(db, () => {
    assertEntryEditable(db, entryId, householdId);
    db.prepare("update ledger_entries set voided_at = CURRENT_TIMESTAMP where id = ? and household_id = ?").run(entryId, householdId);
    db.prepare("update manual_ynab_tasks set status = 'dismissed', updated_at = CURRENT_TIMESTAMP where decision_id in (select id from ynab_transaction_decisions where ledger_entry_id = ?) and status = 'action_needed'").run(entryId);
    db.prepare("update ynab_postings set status = 'skipped', updated_at = CURRENT_TIMESTAMP where decision_id in (select id from ynab_transaction_decisions where ledger_entry_id = ?) and posting_kind = 'source' and status in ('pending', 'failed', 'conflict')").run(entryId);
  });
}
export function editLedgerEntry(db: AppDatabase, entryId: string, householdId: string, patch: { description?: string; categoryId?: string | null }): void {
  withLedgerTransaction(db, () => {
    assertEntryEditable(db, entryId, householdId);
    if (patch.description !== undefined && !patch.description.trim()) throw new Error("Description cannot be empty.");
    db.prepare("update ledger_entries set description = COALESCE(?, description), category_id = COALESCE(?, category_id) where id = ? and household_id = ?").run(patch.description ?? null, patch.categoryId ?? null, entryId, householdId);
  });
}

export function correctLedgerEntry(db: AppDatabase, householdId: string, entryId: string, input: { amountMinor: number; cashMemberKey: "adam" | "chelsea"; kind: "expense" | "income"; date: string; description: string; categoryId?: string | null; shares: [{ memberKey: "adam" | "chelsea"; amountMinor: number }, { memberKey: "adam" | "chelsea"; amountMinor: number }] }): string {
  const [firstShare, secondShare] = input.shares;
  const sharesAreSafe = input.shares.every((share) => Number.isSafeInteger(share.amountMinor) && share.amountMinor >= 0);
  const sharesSumToAmount = Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0 && sharesAreSafe
    && BigInt(firstShare.amountMinor) + BigInt(secondShare.amountMinor) === BigInt(input.amountMinor);
  if (!sharesSumToAmount || firstShare.memberKey === secondShare.memberKey) throw new Error("Corrective shares must be two non-negative integers summing to the amount.");
  const replacementId = randomUUID();
  const correctiveShares = input.shares.map((share) => ({ memberId: share.memberKey, amountMinor: share.amountMinor })) as [{ memberId: string; amountMinor: number }, { memberId: string; amountMinor: number }];
  assertLedgerEntry({ id: replacementId, kind: input.kind, amountMinor: input.amountMinor, cashMemberId: input.cashMemberKey, shares: correctiveShares, date: input.date, description: input.description });
  withLedgerTransaction(db, () => {
    assertEntryEditable(db, entryId, householdId);
    db.prepare("insert into ledger_entries (id, household_id, kind, amount_minor, cash_member_key, entry_date, description, category_id, correction_of_id) select ?, household_id, ?, ?, ?, ?, ?, ?, id from ledger_entries where id = ? and household_id = ?").run(replacementId, input.kind, input.amountMinor, input.cashMemberKey, input.date, input.description, input.categoryId ?? null, entryId, householdId);
    const insertShare = db.prepare("insert into ledger_shares (entry_id, member_key, amount_minor) values (?, ?, ?)");
    for (const share of input.shares) insertShare.run(replacementId, share.memberKey, share.amountMinor);
    db.prepare("update ledger_entries set voided_at = CURRENT_TIMESTAMP where id = ? and household_id = ?").run(entryId, householdId);
    db.prepare("update manual_ynab_tasks set status = 'dismissed', updated_at = CURRENT_TIMESTAMP where decision_id in (select id from ynab_transaction_decisions where ledger_entry_id = ?) and status = 'action_needed'").run(entryId);
    db.prepare("update ynab_postings set status = 'skipped', updated_at = CURRENT_TIMESTAMP where decision_id in (select id from ynab_transaction_decisions where ledger_entry_id = ?) and posting_kind = 'source' and status in ('pending', 'failed', 'conflict')").run(entryId);
  });
  return replacementId;
}


export function dismissManualTask(db: AppDatabase, userId: string, taskId: string): void {
  withLedgerTransaction(db, () => {
    const result = db.prepare("update manual_ynab_tasks set status = 'dismissed', updated_at = CURRENT_TIMESTAMP where id = ? and status = 'action_needed' and decision_id in (select id from ynab_transaction_decisions where user_id = ?)").run(taskId, userId);
    if (result.changes !== 1) throw new Error("Manual task not found, owned by another member, or already resolved.");
  });
}

export async function verifyManualTask(db: AppDatabase, userId: string, taskId: string, gateway: YnabGateway, decimalDigits: number): Promise<{ verified: true } | { verified: false; error: string }> {
  const task = db.prepare("select mt.id, mt.status, mt.intended_target_json, d.plan_id, d.ynab_transaction_id from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id where mt.id = ? and d.user_id = ?").get(taskId, userId) as { id: string; status: string; intended_target_json: string; plan_id: string; ynab_transaction_id: string } | undefined;
  if (!task || task.status !== "action_needed") return { verified: false, error: "Manual task is not actionable or is not owned by this session." };
  const target = JSON.parse(task.intended_target_json) as ManualSplitTarget;
  try {
    const remote = await gateway.getTransaction(task.plan_id, task.ynab_transaction_id);
    const source = sourceForManual(remote, decimalDigits);
    const verification = verifyManualSplitReadback(source, target);
    if (!verification.matches) {
      withLedgerTransaction(db, () => db.prepare("update manual_ynab_tasks set last_error = ?, updated_at = CURRENT_TIMESTAMP where id = ? and status = 'action_needed'").run("Manual read-back did not match the intended split.", task.id));
      return { verified: false, error: "Manual read-back did not match the intended split." };
    }
    withLedgerTransaction(db, () => db.prepare("update manual_ynab_tasks set status = 'verified', remote_readback_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ? and status = 'action_needed'").run(JSON.stringify(remote), task.id));
    return { verified: true };
  } catch { return { verified: false, error: "YNAB verification failed; retry later." }; }
}

export async function retrySourcePosting(db: AppDatabase, userId: string, postingId: string, gateway: YnabGateway): Promise<{ posted: boolean; status: string; error?: string }> {
  const posting = db.prepare("select p.id, p.status, p.intended_target_json, d.plan_id, d.ynab_transaction_id, d.source_snapshot_json from ynab_postings p join ynab_transaction_decisions d on d.id = p.decision_id where p.id = ? and p.user_id = ? and p.posting_kind = 'source'").get(postingId, userId) as { id: string; status: string; intended_target_json: string; plan_id: string; ynab_transaction_id: string; source_snapshot_json: string | null } | undefined;
  if (!posting) return { posted: false, status: "missing", error: "Source posting not found or not owned by this session." };
  if (posting.status === "succeeded") return { posted: true, status: "succeeded" };
  if (posting.status === "skipped") return { posted: false, status: "skipped", error: "Skipped postings cannot be retried." };
  if (!posting.source_snapshot_json) return { posted: false, status: "conflict", error: "Source posting has no immutable review snapshot." };
  const snapshot = JSON.parse(posting.source_snapshot_json) as ReviewedSource;
  const target = JSON.parse(posting.intended_target_json) as SourceUpdateTarget;
  try {
    const current = await gateway.getTransaction(posting.plan_id, posting.ynab_transaction_id);
    if (verifySourceUpdate(snapshot, current, target).length === 0) {
      updatePosting(db, posting.id, "succeeded", { remote: current });
      return { posted: true, status: "succeeded" };
    }
    const stale = verifyReviewedSource(snapshot, current).filter((difference) => difference !== "category changed" && difference !== "approval changed");
    if (stale.length > 0) {
      updatePosting(db, posting.id, "conflict", { error: "YNAB source changed since review.", remote: current });
      return { posted: false, status: "conflict", error: "YNAB source changed since review; refresh before retrying." };
    }
    const readback = await gateway.updateTransaction(posting.plan_id, posting.ynab_transaction_id, target as unknown as Record<string, unknown>);
    const differences = verifySourceUpdate(snapshot, readback, target);
    if (differences.length > 0) {
      updatePosting(db, posting.id, "conflict", { error: "YNAB read-back did not match the requested update.", remote: readback });
      return { posted: false, status: "conflict", error: "YNAB read-back did not match the requested update." };
    }
    updatePosting(db, posting.id, "succeeded", { remote: readback });
    return { posted: true, status: "succeeded" };
  } catch (error) {
    const status = isIndeterminate(error) ? "pending" : "failed";
    updatePosting(db, posting.id, status, { error: safeError(error) });
    return { posted: false, status, error: safeError(error) };
  }
}
export function prepareManualTask(db: AppDatabase, userId: string, taskId: string, splittingCategoryId: string | null, categoryIds: string[], amounts: number[]): void {
  if (!splittingCategoryId) throw new Error("Configure the Splitting category before editing this task.");
  if (categoryIds.length === 0 || categoryIds.length !== amounts.length || categoryIds.some((categoryId) => categoryId.length === 0) || amounts.some((amount) => !Number.isSafeInteger(amount))) throw new Error("Enter an integer amount for every owner category.");
  const task = db.prepare("select mt.id, mt.status, mt.intended_target_json from manual_ynab_tasks mt join ynab_transaction_decisions d on d.id = mt.decision_id where mt.id = ? and d.user_id = ?").get(taskId, userId) as { id: string; status: string; intended_target_json: string } | undefined;
  if (!task || task.status !== "action_needed") throw new Error("Manual task is not actionable or is not owned by this session.");
  const target = JSON.parse(task.intended_target_json) as ManualSplitTarget;
  const source: ManualSourceTransaction = {
    id: target.parentId ?? "",
    date: target.date,
    amountMinor: target.parentAmountMinor,
    accountId: target.accountId,
    payeeName: target.payeeName,
    approved: true,
    subtransactions: target.lines.map((line) => ({ categoryId: line.categoryId, amountMinor: line.amountMinor, payeeName: line.payeeName, memo: line.memo })),
  };
  const ownerShareMinor = target.lines.slice(0, -1).reduce((sum, line) => sum + line.amountMinor, 0);
  const allocations = categoryIds.map((categoryId, index) => ({ categoryId, amountMinor: amounts[index], payeeName: target.lines.find((line) => line.categoryId === categoryId)?.payeeName ?? null, memo: target.lines.find((line) => line.categoryId === categoryId)?.memo ?? null }));
  const nextTarget = { ...buildManualSplitTarget(source, ownerShareMinor, allocations, splittingCategoryId), parentId: target.parentId };
  withLedgerTransaction(db, () => {
    db.prepare("update manual_ynab_tasks set intended_target_json = ?, last_error = null, updated_at = CURRENT_TIMESTAMP where id = ? and status = 'action_needed'").run(JSON.stringify(nextTarget), task.id);
  });
}
