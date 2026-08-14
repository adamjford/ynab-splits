import { createHash } from "node:crypto";
import type { YnabTransaction } from "./ynab.server";

export interface SourceUpdateTarget {
  category_id: string | null;
  approved: boolean;
  subtransactions: Array<{ amount: number; category_id: string | null }>;
}

function snapshot(value: Pick<YnabTransaction, "id" | "date" | "amount" | "account_id" | "payee_name" | "category_id" | "approved" | "deleted" | "transfer_account_id" | "subtransactions">): string {
  return JSON.stringify({ id: value.id, date: value.date, amount: value.amount, account_id: value.account_id, payee_name: value.payee_name ?? null, category_id: value.category_id, approved: value.approved, deleted: value.deleted, transfer_account_id: value.transfer_account_id ?? null, subtransactions: value.subtransactions.map((line) => ({ amount: line.amount, category_id: line.category_id })).sort((left, right) => `${left.category_id}:${left.amount}`.localeCompare(`${right.category_id}:${right.amount}`)) });
}

export function sourceSnapshotHash(value: Parameters<typeof snapshot>[0]): string {
  return createHash("sha256").update(snapshot(value)).digest("hex");
}

export function verifyReviewedSource(reviewed: Parameters<typeof snapshot>[0], current: Parameters<typeof snapshot>[0]): string[] {
  if (sourceSnapshotHash(reviewed) === sourceSnapshotHash(current)) return [];
  const differences: string[] = [];
  if (reviewed.id !== current.id) differences.push(`id: expected ${reviewed.id}, got ${current.id}`);
  if (reviewed.date !== current.date) differences.push(`date: expected ${reviewed.date}, got ${current.date}`);
  if (reviewed.amount !== current.amount) differences.push(`amount: expected ${reviewed.amount}, got ${current.amount}`);
  if (reviewed.account_id !== current.account_id) differences.push(`account: expected ${reviewed.account_id}, got ${current.account_id}`);
  if ((reviewed.payee_name ?? null) !== (current.payee_name ?? null)) differences.push(`payee changed`);
  if (reviewed.category_id !== current.category_id) differences.push(`category changed`);
  if (reviewed.approved !== current.approved) differences.push(`approval changed`);
  return differences.length > 0 ? differences : ["source changed since review"];
}
export function verifySourceUpdate(reviewed: Parameters<typeof snapshot>[0], remote: Parameters<typeof snapshot>[0], target: SourceUpdateTarget): string[] {
  const differences: string[] = [];
  if (reviewed.id !== remote.id) differences.push(`id: expected ${reviewed.id}, got ${remote.id}`);
  if (reviewed.date !== remote.date) differences.push(`date: expected ${reviewed.date}, got ${remote.date}`);
  if (reviewed.amount !== remote.amount) differences.push(`amount: expected ${reviewed.amount}, got ${remote.amount}`);
  if (reviewed.account_id !== remote.account_id) differences.push(`account: expected ${reviewed.account_id}, got ${remote.account_id}`);
  if ((reviewed.payee_name ?? null) !== (remote.payee_name ?? null)) differences.push(`payee changed`);
  if (remote.category_id !== target.category_id) differences.push(`category: expected ${target.category_id ?? "split"}, got ${remote.category_id ?? "split"}`);
  if (remote.approved !== target.approved) differences.push(`approved: expected ${target.approved}, got ${remote.approved}`);
  const expected = target.subtransactions.map((line) => `${line.category_id}:${line.amount}`).sort();
  const actual = remote.subtransactions.map((line) => `${line.category_id}:${line.amount}`).sort();
  if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index])) differences.push(`subtransactions: expected ${expected.join(", ")}, got ${actual.join(", ")}`);
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

export function verifyCreatedPosting(target: CreatedPostingTarget, remote: Pick<YnabTransaction, "import_id" | "account_id" | "date" | "amount" | "payee_name" | "category_id" | "approved" | "subtransactions">): string[] {
  const differences: string[] = [];
  if (remote.import_id !== target.import_id) differences.push(`import id: expected ${target.import_id}, got ${remote.import_id ?? "(none)"}`);
  if (remote.account_id !== target.account_id) differences.push(`account: expected ${target.account_id}, got ${remote.account_id}`);
  if (remote.date !== target.date) differences.push(`date: expected ${target.date}, got ${remote.date}`);
  if (remote.amount !== target.amount) differences.push(`amount: expected ${target.amount}, got ${remote.amount}`);
  if ((remote.payee_name ?? null) !== target.payee_name) differences.push(`payee: expected ${target.payee_name}, got ${remote.payee_name ?? "(none)"}`);
  if (remote.category_id !== target.category_id) differences.push(`category: expected ${target.category_id ?? "split"}, got ${remote.category_id ?? "split"}`);
  if (remote.approved !== target.approved) differences.push(`approved: expected ${target.approved}, got ${remote.approved}`);
  const expected = target.subtransactions.map((line) => `${line.category_id}:${line.amount}:${line.memo ?? ""}`).sort();
  const actual = remote.subtransactions.map((line) => `${line.category_id}:${line.amount}:${line.memo ?? ""}`).sort();
  if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index])) differences.push(`subtransactions: expected ${expected.join(", ")}, got ${actual.join(", ")}`);
  return differences;
}
