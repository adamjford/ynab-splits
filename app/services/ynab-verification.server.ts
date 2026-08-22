import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { YnabTransaction } from "./ynab.server";

export interface SourceUpdateTarget {
  category_id: string | null;
  approved: boolean;
  subtransactions: Array<{ amount: number; category_id: string | null }>;
}

export type ReviewedSource = Pick<
  YnabTransaction,
  | "id"
  | "date"
  | "amount"
  | "account_id"
  | "payee_name"
  | "category_id"
  | "approved"
  | "deleted"
  | "transfer_account_id"
  | "subtransactions"
>;

export interface ReviewedSnapshotClaims {
  userId: string;
  planId: string;
  transactionId: string;
  expiresAt: number;
  snapshot: ReviewedSource;
}

function snapshot(value: ReviewedSource): string {
  return JSON.stringify({
    id: value.id,
    date: value.date,
    amount: value.amount,
    account_id: value.account_id,
    payee_name: value.payee_name ?? null,
    category_id: value.category_id,
    approved: value.approved,
    deleted: value.deleted,
    transfer_account_id: value.transfer_account_id ?? null,
    subtransactions: value.subtransactions
      .map((line) => ({
        id: line.id ?? null,
        amount: line.amount,
        category_id: line.category_id,
        payee_name: line.payee_name ?? null,
        memo: line.memo ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

function tokenSignature(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function signReviewedSnapshot(secret: string, claims: ReviewedSnapshotClaims): string {
  if (!secret || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= Math.floor(Date.now() / 1000))
    throw new Error("invalid reviewed snapshot");
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${tokenSignature(secret, payload).toString("base64url")}`;
}

export function verifyReviewedSnapshotToken(
  secret: string,
  token: string,
  expected: Pick<ReviewedSnapshotClaims, "userId" | "planId" | "transactionId">,
  now = Math.floor(Date.now() / 1000),
): ReviewedSnapshotClaims {
  try {
    const [payload, encodedSignature] = token.split(".");
    if (!payload || !encodedSignature) throw new Error("invalid reviewed snapshot");
    const actual = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = tokenSignature(secret, payload);
    if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature))
      throw new Error("invalid reviewed snapshot");
    const claims = JSON.parse(decode(payload)) as ReviewedSnapshotClaims;
    if (
      claims.userId !== expected.userId ||
      claims.planId !== expected.planId ||
      claims.transactionId !== expected.transactionId ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.expiresAt <= now
    )
      throw new Error("reviewed snapshot expired or mismatched");
    if (!claims.snapshot || claims.snapshot.id !== claims.transactionId) throw new Error("invalid reviewed snapshot");
    return claims;
  } catch {
    throw new Error("reviewed snapshot is invalid or expired");
  }
}
export const createReviewedSnapshotToken = signReviewedSnapshot;
export const verifyReviewedSnapshot = verifyReviewedSnapshotToken;

export function sourceSnapshotHash(value: ReviewedSource): string {
  return createHash("sha256").update(snapshot(value)).digest("hex");
}

export function verifyReviewedSource(reviewed: ReviewedSource, current: ReviewedSource): string[] {
  if (sourceSnapshotHash(reviewed) === sourceSnapshotHash(current)) return [];
  const differences: string[] = [];
  if (reviewed.id !== current.id) differences.push(`id: expected ${reviewed.id}, got ${current.id}`);
  if (reviewed.date !== current.date) differences.push(`date: expected ${reviewed.date}, got ${current.date}`);
  if (reviewed.amount !== current.amount)
    differences.push(`amount: expected ${reviewed.amount}, got ${current.amount}`);
  if (reviewed.account_id !== current.account_id)
    differences.push(`account: expected ${reviewed.account_id}, got ${current.account_id}`);
  if ((reviewed.payee_name ?? null) !== (current.payee_name ?? null)) differences.push("payee changed");
  if (reviewed.category_id !== current.category_id) differences.push("category changed");
  if (reviewed.approved !== current.approved) differences.push("approval changed");
  if (reviewed.deleted !== current.deleted) differences.push("deletion changed");
  if ((reviewed.transfer_account_id ?? null) !== (current.transfer_account_id ?? null))
    differences.push("transfer changed");
  if (JSON.stringify(reviewed.subtransactions) !== JSON.stringify(current.subtransactions))
    differences.push("subtransactions changed");
  return differences.length > 0 ? differences : ["source changed since review"];
}
export function verifySourceUpdate(
  reviewed: Parameters<typeof snapshot>[0],
  remote: Parameters<typeof snapshot>[0],
  target: SourceUpdateTarget,
): string[] {
  const differences: string[] = [];
  if (reviewed.id !== remote.id) differences.push(`id: expected ${reviewed.id}, got ${remote.id}`);
  if (reviewed.date !== remote.date) differences.push(`date: expected ${reviewed.date}, got ${remote.date}`);
  if (reviewed.amount !== remote.amount) differences.push(`amount: expected ${reviewed.amount}, got ${remote.amount}`);
  if (reviewed.account_id !== remote.account_id)
    differences.push(`account: expected ${reviewed.account_id}, got ${remote.account_id}`);
  if ((reviewed.payee_name ?? null) !== (remote.payee_name ?? null)) differences.push(`payee changed`);
  if (remote.category_id !== target.category_id)
    differences.push(`category: expected ${target.category_id ?? "split"}, got ${remote.category_id ?? "split"}`);
  if (remote.approved !== target.approved)
    differences.push(`approved: expected ${target.approved}, got ${remote.approved}`);
  const expected = target.subtransactions.map((line) => `${line.category_id}:${line.amount}`).sort();
  const actual = remote.subtransactions.map((line) => `${line.category_id}:${line.amount}`).sort();
  if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index]))
    differences.push(`subtransactions: expected ${expected.join(", ")}, got ${actual.join(", ")}`);
  return differences;
}

export interface CreatedPostingTarget {
  import_id: string;
  account_id: string;
  date: string;
  amount: number;
  payee_name: string;
  category_id: string | null;
  approved: boolean;
  subtransactions: Array<{ amount: number; category_id: string | null; memo?: string | null }>;
}

export function verifyCreatedPosting(
  target: CreatedPostingTarget,
  remote: Pick<
    YnabTransaction,
    "import_id" | "account_id" | "date" | "amount" | "payee_name" | "category_id" | "approved" | "subtransactions"
  >,
): string[] {
  const differences: string[] = [];
  if (remote.import_id !== target.import_id)
    differences.push(`import id: expected ${target.import_id}, got ${remote.import_id ?? "(none)"}`);
  if (remote.account_id !== target.account_id)
    differences.push(`account: expected ${target.account_id}, got ${remote.account_id}`);
  if (remote.date !== target.date) differences.push(`date: expected ${target.date}, got ${remote.date}`);
  if (remote.amount !== target.amount) differences.push(`amount: expected ${target.amount}, got ${remote.amount}`);
  if ((remote.payee_name ?? null) !== target.payee_name)
    differences.push(`payee: expected ${target.payee_name}, got ${remote.payee_name ?? "(none)"}`);
  if (remote.category_id !== target.category_id)
    differences.push(`category: expected ${target.category_id ?? "split"}, got ${remote.category_id ?? "split"}`);
  if (remote.approved !== target.approved)
    differences.push(`approved: expected ${target.approved}, got ${remote.approved}`);
  const expected = target.subtransactions.map((line) => `${line.category_id}:${line.amount}:${line.memo ?? ""}`).sort();
  const actual = remote.subtransactions.map((line) => `${line.category_id}:${line.amount}:${line.memo ?? ""}`).sort();
  if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index]))
    differences.push(`subtransactions: expected ${expected.join(", ")}, got ${actual.join(", ")}`);
  return differences;
}
