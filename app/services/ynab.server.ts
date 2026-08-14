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

interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface YnabResponse<T> {
  data: T;
}

const API_ORIGIN = "https://api.ynab.com/v1";
const TOKEN_URL = "https://app.ynab.com/oauth2/token";

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
  ) {
    this.token = { accessToken, refreshToken, expiresAt };
  }

  async getUser(): Promise<YnabUser> {
    return (await this.request<YnabResponse<{ user: YnabUser }>>("/user")).data.user;
  }

  async getPlans(): Promise<YnabPlan[]> {
    return (await this.request<YnabResponse<{ plans: YnabPlan[] }>>("/plans")).data.plans;
  }

  async getAccounts(planId: string): Promise<YnabAccount[]> {
    return (await this.request<YnabResponse<{ accounts: YnabAccount[] }>>(`/budgets/${encodeURIComponent(planId)}/accounts`)).data.accounts;
  }

  async getCategories(planId: string): Promise<YnabCategory[]> {
    return (await this.request<YnabResponse<{ category_groups: Array<{ categories: YnabCategory[] }> }>>(`/budgets/${encodeURIComponent(planId)}/categories`)).data.category_groups.flatMap((group) => group.categories);
  }

  async getUnapprovedTransactions(planId: string): Promise<YnabTransaction[]> {
    return (await this.request<YnabResponse<{ transactions: YnabTransaction[] }>>(`/budgets/${encodeURIComponent(planId)}/transactions?type=unapproved`)).data.transactions;
  }

  async getTransaction(planId: string, transactionId: string): Promise<YnabTransaction> {
    return (await this.request<YnabResponse<{ transaction: YnabTransaction }>>(`/budgets/${encodeURIComponent(planId)}/transactions/${encodeURIComponent(transactionId)}`)).data.transaction;
  }

  async findTransactionByImportId(planId: string, importId: string): Promise<YnabTransaction | null> {
    const transactions = (await this.request<YnabResponse<{ transactions: YnabTransaction[] }>>(`/budgets/${encodeURIComponent(planId)}/transactions`)).data.transactions;
    return transactions.find((transaction) => transaction.import_id === importId) ?? null;
  }

  async updateTransaction(planId: string, transactionId: string, target: Record<string, unknown>): Promise<YnabTransaction> {
    return (await this.request<YnabResponse<{ transaction: YnabTransaction }>>(`/budgets/${encodeURIComponent(planId)}/transactions/${encodeURIComponent(transactionId)}`, { method: "PUT", body: JSON.stringify(target) })).data.transaction;
  }

  async createTransaction(planId: string, target: Record<string, unknown>): Promise<YnabTransaction> {
    return (await this.request<YnabResponse<{ transaction: YnabTransaction }>>(`/budgets/${encodeURIComponent(planId)}/transactions`, { method: "POST", body: JSON.stringify({ transactions: [target] }) })).data.transaction;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.refreshIfNeeded();
    const response = await this.fetchImpl(`${API_ORIGIN}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.token.accessToken}`, ...(init.headers ?? {}) },
    });
    if (response.status === 401) throw new Error("YNAB authentication expired");
    if (response.status === 429) throw new Error("YNAB rate limit reached");
    if (!response.ok) throw new Error(`YNAB request failed with ${response.status}`);
    return (await response.json()) as T;
  }

  private async refreshIfNeeded(): Promise<void> {
    if (this.token.expiresAt > Date.now() + 60_000) return;
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token", refresh_token: this.token.refreshToken }),
    });
    if (!response.ok) throw new Error("YNAB token refresh failed");
    const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    this.token = { accessToken: body.access_token, refreshToken: body.refresh_token ?? this.token.refreshToken, expiresAt: Date.now() + body.expires_in * 1000 };
    await this.onTokenRefresh?.(this.token);
  }
}
