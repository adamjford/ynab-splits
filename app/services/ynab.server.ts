import { z } from "zod";

export interface YnabUser {
  id: string;
}

export interface YnabPlan {
  id: string;
  name: string;
  currency_format?: { iso_code: string; decimal_digits: number } | null;
}

export interface YnabAccount {
  id: string;
  name: string;
  deleted: boolean;
  transfer_payee_id?: string | null;
}

export interface YnabCategory {
  id: string;
  name: string;
  deleted: boolean;
}

export interface YnabSubtransaction {
  id?: string;
  amount: number;
  category_id: string | null;
  category_name?: string | null;
  payee_name?: string | null;
  memo?: string | null;
}

export interface YnabTransaction {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  account_name?: string;
  payee_name?: string | null;
  category_id: string | null;
  category_name?: string | null;
  memo?: string | null;
  cleared?: string;
  approved: boolean;
  deleted: boolean;
  transfer_account_id?: string | null;
  import_id?: string | null;
  subtransactions: YnabSubtransaction[];
}

export interface YnabGateway {
  getUser(): Promise<YnabUser>;
  getPlans(): Promise<YnabPlan[]>;
  getAccounts(planId: string): Promise<YnabAccount[]>;
  getCategories(planId: string): Promise<YnabCategory[]>;
  getUnapprovedTransactions(planId: string): Promise<YnabTransaction[]>;
  getTransaction(planId: string, transactionId: string): Promise<YnabTransaction>;
  findTransactionByImportId(planId: string, importId: string): Promise<YnabTransaction | null>;
  updateTransaction(planId: string, transactionId: string, target: Record<string, unknown>): Promise<YnabTransaction>;
  createTransaction(planId: string, target: Record<string, unknown>): Promise<YnabTransaction>;
}

export interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type YnabTransportErrorKind = "unauthorized" | "rate_limit" | "timeout" | "malformed" | "http" | "network";

export class YnabTransportError extends Error {
  constructor(public readonly kind: YnabTransportErrorKind, public readonly status?: number) {
    super(kind === "unauthorized" ? "YNAB authentication expired" :
      kind === "rate_limit" ? "YNAB rate limit reached" :
      kind === "timeout" ? "YNAB request timed out" :
      kind === "malformed" ? "YNAB returned an invalid response" :
      kind === "network" ? "YNAB request could not be completed" :
      "YNAB request failed");
    this.name = "YnabTransportError";
  }
}

const DEFAULT_API_ORIGIN = "https://api.ynab.com/v1";
const DEFAULT_OAUTH_ORIGIN = "https://app.ynab.com";
const REQUEST_TIMEOUT_MS = 15_000;
const nonEmptyId = z.string().trim().min(1);
const milliunits = z.number().finite().int();
const userSchema = z.object({ id: nonEmptyId });
const planSchema = z.object({
  id: nonEmptyId,
  name: z.string(),
  currency_format: z.object({ iso_code: z.string().length(3), decimal_digits: z.number().int().min(0).max(3) }).nullable().optional(),
}).passthrough();
const accountSchema = z.object({ id: nonEmptyId, name: z.string(), deleted: z.boolean(), transfer_payee_id: nonEmptyId.nullable().optional() }).passthrough();
const categorySchema = z.object({ id: nonEmptyId, name: z.string(), deleted: z.boolean() }).passthrough();
const subtransactionSchema = z.object({
  id: nonEmptyId.optional(),
  amount: milliunits,
  category_id: nonEmptyId.nullable(),
  category_name: z.string().nullable().optional(),
  payee_name: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
}).passthrough();
const transactionSchema = z.object({
  id: nonEmptyId,
  date: z.string().min(1),
  amount: milliunits,
  account_id: nonEmptyId,
  account_name: z.string().optional(),
  payee_name: z.string().nullable().optional(),
  category_id: nonEmptyId.nullable(),
  category_name: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  cleared: z.string().optional(),
  approved: z.boolean(),
  deleted: z.boolean(),
  transfer_account_id: nonEmptyId.nullable().optional(),
  import_id: z.string().nullable().optional(),
  subtransactions: z.array(subtransactionSchema),
}).passthrough();
const tokenStateSchema = z.object({
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().min(1).optional(),
  expires_in: z.number().finite().int().positive(),
});

type Schema<T> = z.ZodType<T>;

export class HttpYnabGateway implements YnabGateway {
  private token: TokenState;

  constructor(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onTokenRefresh?: (token: TokenState) => Promise<void>,
    private readonly onUnauthorized?: () => Promise<void>,
    private readonly apiOrigin: string = DEFAULT_API_ORIGIN,
    private readonly oauthOrigin: string = DEFAULT_OAUTH_ORIGIN,
  ) {
    this.token = { accessToken, refreshToken, expiresAt };
  }

  async getUser(): Promise<YnabUser> {
    return (await this.request(z.object({ data: z.object({ user: userSchema }) }), "/user")).data.user;
  }

  async getPlans(): Promise<YnabPlan[]> {
    return (await this.request(z.object({ data: z.object({ plans: z.array(planSchema) }) }), "/plans")).data.plans;
  }

  async getAccounts(planId: string): Promise<YnabAccount[]> {
    return (await this.request(z.object({ data: z.object({ accounts: z.array(accountSchema) }) }), `/plans/${encodeURIComponent(planId)}/accounts`)).data.accounts;
  }

  async getCategories(planId: string): Promise<YnabCategory[]> {
    return (await this.request(z.object({ data: z.object({ category_groups: z.array(z.object({ categories: z.array(categorySchema) })) }) }), `/plans/${encodeURIComponent(planId)}/categories`)).data.category_groups.flatMap((group) => group.categories);
  }

  async getUnapprovedTransactions(planId: string): Promise<YnabTransaction[]> {
    return (await this.request(z.object({ data: z.object({ transactions: z.array(transactionSchema) }) }), `/plans/${encodeURIComponent(planId)}/transactions?type=unapproved`)).data.transactions;
  }

  async getTransaction(planId: string, transactionId: string): Promise<YnabTransaction> {
    return (await this.request(z.object({ data: z.object({ transaction: transactionSchema }) }), `/plans/${encodeURIComponent(planId)}/transactions/${encodeURIComponent(transactionId)}`)).data.transaction;
  }

  async findTransactionByImportId(planId: string, importId: string): Promise<YnabTransaction | null> {
    const transactions = (await this.request(z.object({ data: z.object({ transactions: z.array(transactionSchema) }) }), `/plans/${encodeURIComponent(planId)}/transactions`)).data.transactions;
    return transactions.find((transaction) => transaction.import_id === importId) ?? null;
  }

  async updateTransaction(planId: string, transactionId: string, target: Record<string, unknown>): Promise<YnabTransaction> {
    const body = await this.request(z.object({ data: z.object({ transaction: transactionSchema }) }), `/plans/${encodeURIComponent(planId)}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "PUT",
      body: JSON.stringify({ transaction: target }),
    });
    return body.data.transaction;
  }

  async createTransaction(planId: string, target: Record<string, unknown>): Promise<YnabTransaction> {
    const body = await this.request(z.object({ data: z.object({ transaction_ids: z.array(nonEmptyId), duplicate_import_ids: z.array(z.string()) }) }), `/plans/${encodeURIComponent(planId)}/transactions`, {
      method: "POST",
      body: JSON.stringify({ transaction: target }),
    });
    if (body.data.transaction_ids.length !== 1 || body.data.duplicate_import_ids.length !== 0) throw new YnabTransportError("malformed");
    return this.getTransaction(planId, body.data.transaction_ids[0]);
  }

  private async request<T>(schema: Schema<T>, path: string, init: RequestInit = {}): Promise<T> {
    await this.refreshIfNeeded();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.apiOrigin}${path}`, {
        ...init,
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.token.accessToken}`, ...(init.headers ?? {}) },
      });
    } catch (error) {
      if (error instanceof YnabTransportError) throw error;
      throw new YnabTransportError("network");
    }
    if (response.status === 401) {
      try { await this.onUnauthorized?.(); } catch { /* disconnect bookkeeping must not expose database details */ }
      throw new YnabTransportError("unauthorized", 401);
    }
    if (response.status === 429) throw new YnabTransportError("rate_limit", 429);
    if (!response.ok) throw new YnabTransportError("http", response.status);
    return this.parseJson(response, schema);
  }

  private async parseJson<T>(response: Response, schema: Schema<T>): Promise<T> {
    let body: unknown;
    try { body = await response.json(); } catch { throw new YnabTransportError("malformed"); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new YnabTransportError("malformed");
    return parsed.data;
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const externalSignal = init.signal;
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch {
      if (timedOut) throw new YnabTransportError("timeout");
      throw new YnabTransportError("network");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  private async refreshIfNeeded(): Promise<void> {
    if (this.token.expiresAt > Date.now() + 60_000) return;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(new URL("/oauth/token", this.oauthOrigin), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token", refresh_token: this.token.refreshToken }),
      });
    } catch (error) {
      if (error instanceof YnabTransportError) throw error;
      throw new YnabTransportError("network");
    }
    if (response.status === 401) throw new YnabTransportError("unauthorized", 401);
    if (response.status === 429) throw new YnabTransportError("rate_limit", 429);
    if (!response.ok) throw new YnabTransportError("http", response.status);
    const parsed = await this.parseJson(response, tokenStateSchema);
    const candidate: TokenState = { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? this.token.refreshToken, expiresAt: Date.now() + parsed.expires_in * 1000 };
    await this.onTokenRefresh?.(candidate);
    this.token = candidate;
  }
}
