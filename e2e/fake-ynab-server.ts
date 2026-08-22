import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";

export type FakeIdentity = "adam" | "chelsea";
export type FakeControl = "success" | "unauthorized" | "rate_limit" | "timeout" | "duplicate";

const FAKE_PORT_DEFAULT = 4010;
const configuredFakePort =
  process.env.E2E_FAKE_PORT === undefined ? FAKE_PORT_DEFAULT : Number(process.env.E2E_FAKE_PORT);
export const FAKE_PORT = configuredFakePort;
export const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;

const identities: Record<
  FakeIdentity,
  {
    userId: string;
    planId: string;
    accountId: string;
    splittingCategoryId: string;
    categoryId: string;
    transactions: FakeTransaction[];
  }
> = {
  adam: {
    userId: "fake-user-adam",
    planId: "fake-plan-adam",
    accountId: "fake-account-adam",
    splittingCategoryId: "fake-category-splitting-adam",
    categoryId: "fake-category-groceries-adam",
    transactions: [
      {
        id: "fake-transaction-adam-1",
        date: "2026-08-01",
        amount: -18890,
        account_id: "fake-account-adam",
        account_name: "Adam checking",
        payee_name: "Local market",
        category_id: "fake-category-groceries-adam",
        category_name: "Groceries",
        memo: "Shared dinner",
        cleared: "cleared",
        approved: false,
        deleted: false,
        subtransactions: [],
      },
    ],
  },
  chelsea: {
    userId: "fake-user-chelsea",
    planId: "fake-plan-chelsea",
    accountId: "fake-account-chelsea",
    splittingCategoryId: "fake-category-splitting-chelsea",
    categoryId: "fake-category-groceries-chelsea",
    transactions: [
      {
        id: "fake-transaction-chelsea-1",
        date: "2026-08-02",
        amount: -11540,
        account_id: "fake-account-chelsea",
        account_name: "Chelsea checking",
        payee_name: "Corner shop",
        category_id: "fake-category-groceries-chelsea",
        category_name: "Groceries",
        memo: "Shared snacks",
        cleared: "cleared",
        approved: false,
        deleted: false,
        subtransactions: [],
      },
    ],
  },
};

type FakeTransaction = {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  account_name: string;
  payee_name: string;
  category_id: string;
  category_name: string;
  memo: string;
  cleared: string;
  approved: boolean;
  deleted: boolean;
  import_id?: string | null;
  subtransactions: Array<Record<string, unknown>>;
};

type ControlState = { mode: FakeControl; path: string | null };
type FakeState = { control: ControlState; transactions: Record<string, FakeTransaction> };
const initialTransactions = (): Record<string, FakeTransaction> =>
  Object.fromEntries(
    Object.values(identities).flatMap((identity) =>
      identity.transactions.map((transaction) => [transaction.id, structuredClone(transaction)]),
    ),
  );
function createState(): FakeState {
  return { control: { mode: "success", path: null }, transactions: initialTransactions() };
}

function resetState(state: FakeState): void {
  for (const id of Object.keys(state.transactions)) delete state.transactions[id];
  Object.assign(state.transactions, initialTransactions());
  state.control = { mode: "success", path: null };
}

export type FakeServerOptions = {
  port?: number;
  identity?: FakeIdentity;
  onReset?: () => void;
};

function validPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`fake YNAB port must be an integer from 1 to 65535, received ${port}`);
  return port;
}

function identityFromToken(token: string | undefined): FakeIdentity | null {
  if (token === "fake-access-adam" || token === "fake-refresh-adam") return "adam";
  if (token === "fake-access-chelsea" || token === "fake-refresh-chelsea") return "chelsea";
  return null;
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  if ((request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function shouldControl(state: FakeState, path: string): FakeControl | null {
  if (state.control.path && path !== state.control.path) return null;
  return state.control.mode === "success" ? null : state.control.mode;
}

function planFor(identity: FakeIdentity) {
  const item = identities[identity];
  return {
    id: item.planId,
    name: `${identity[0].toUpperCase()}${identity.slice(1)} test plan`,
    currency_format: { iso_code: "USD", decimal_digits: 2 },
  };
}

function transactionFor(identity: FakeIdentity, transaction: FakeTransaction): FakeTransaction {
  return { ...transaction, subtransactions: transaction.subtransactions.map((line) => ({ ...line })) };
}

function handleApi(
  state: FakeState,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): void | Promise<void> {
  const auth = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const identity = identityFromToken(auth);
  if (!identity)
    return json(response, 401, { error: { id: "unauthorized", name: "Unauthorized", detail: "test-only" } });
  const control = shouldControl(state, url.pathname);
  if (control === "unauthorized") return json(response, 401, { error: { id: "unauthorized", name: "Unauthorized" } });
  if (control === "rate_limit") return json(response, 429, { error: { id: "rate_limit", name: "Rate limited" } });
  if (control === "timeout") return new Promise<void>(() => undefined);
  const item = identities[identity];
  const planMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)(?:\/(.*))?$/);
  const planId = planMatch?.[1];
  const resource = planMatch?.[2] ?? "";
  if (url.pathname === "/v1/user" && request.method === "GET")
    return json(response, 200, { data: { user: { id: item.userId } } });
  if (url.pathname === "/v1/plans" && request.method === "GET")
    return json(response, 200, { data: { plans: [planFor(identity)] } });
  if (planId !== item.planId) return json(response, 404, { error: { id: "plan_not_found", name: "Not found" } });
  if (resource === "accounts" && request.method === "GET")
    return json(response, 200, {
      data: { accounts: [{ id: item.accountId, name: `${identity} checking`, deleted: false }] },
    });
  if (resource === "categories" && request.method === "GET")
    return json(response, 200, {
      data: {
        category_groups: [
          {
            categories: [
              { id: item.categoryId, name: "Groceries", deleted: false },
              { id: item.splittingCategoryId, name: "Splitting", deleted: false },
            ],
          },
        ],
      },
    });
  if (resource === "transactions" && request.method === "GET") {
    const importId = url.searchParams.get("import_id");
    const transactions = Object.values(state.transactions).filter(
      (transaction) => transaction.account_id === item.accountId && (!importId || transaction.import_id === importId),
    );
    if (url.searchParams.get("type") === "unapproved")
      return json(response, 200, {
        data: { transactions: transactions.filter((transaction) => !transaction.approved) },
      });
    return json(response, 200, {
      data: { transactions: transactions.map((transaction) => transactionFor(identity, transaction)) },
    });
  }
  const transactionMatch = resource.match(/^transactions\/([^/]+)$/);
  if (transactionMatch && request.method === "GET") {
    const transaction = state.transactions[decodeURIComponent(transactionMatch[1])];
    if (!transaction || transaction.account_id !== item.accountId)
      return json(response, 404, { error: { id: "transaction_not_found", name: "Not found" } });
    return json(response, 200, { data: { transaction: transactionFor(identity, transaction) } });
  }
  if (transactionMatch && request.method === "PUT") {
    return body(request).then((payload) => {
      const target = (payload.transaction ?? {}) as Partial<FakeTransaction>;
      const id = decodeURIComponent(transactionMatch[1]);
      const transaction = state.transactions[id];
      if (!transaction || transaction.account_id !== item.accountId)
        return json(response, 404, { error: { id: "transaction_not_found", name: "Not found" } });
      Object.assign(transaction, target);
      return json(response, 200, { data: { transaction: transactionFor(identity, transaction) } });
    });
  }
  if (resource === "transactions" && request.method === "POST") {
    return body(request).then((payload) => {
      const target = (payload.transaction ?? {}) as Partial<FakeTransaction>;
      const importId = typeof target.import_id === "string" ? target.import_id : null;
      const existing = importId
        ? Object.values(state.transactions).find(
            (transaction) => transaction.account_id === item.accountId && transaction.import_id === importId,
          )
        : undefined;
      if (existing || shouldControl(state, url.pathname) === "duplicate")
        return json(response, 200, {
          data: { transaction_ids: [], duplicate_import_ids: importId ? [importId] : ["duplicate"] },
        });
      const id = `fake-created-${randomUUID()}`;
      const transaction: FakeTransaction = {
        id,
        date: String(target.date ?? "2026-08-03"),
        amount: Number(target.amount ?? 0),
        account_id: item.accountId,
        account_name: `${identity} checking`,
        payee_name: String(target.payee_name ?? "Household settlement"),
        category_id: typeof target.category_id === "string" ? target.category_id : item.splittingCategoryId,
        category_name: "Splitting",
        memo: String(target.memo ?? ""),
        cleared: "cleared",
        approved: Boolean(target.approved ?? true),
        deleted: false,
        import_id: importId,
        subtransactions: Array.isArray(target.subtransactions)
          ? (target.subtransactions as Array<Record<string, unknown>>)
          : [],
      };
      state.transactions[id] = transaction;
      return json(response, 200, { data: { transaction_ids: [id], duplicate_import_ids: [] } });
    });
  }
  return json(response, 404, { error: { id: "not_found", name: "Not found" } });
}

async function handle(
  state: FakeState,
  origin: string,
  identity: FakeIdentity,
  request: IncomingMessage,
  response: ServerResponse,
  onReset?: () => void,
): Promise<void> {
  const url = new URL(request.url ?? "/", origin);
  if (url.pathname === "/__health") return json(response, 200, { ok: true });
  if (url.pathname === "/__reset" && request.method === "POST") {
    resetState(state);
    onReset?.();
    return json(response, 200, { ok: true });
  }
  if (url.pathname === "/__control" && request.method === "POST") {
    const payload = await body(request);
    const mode = payload.mode;
    if (
      mode !== "success" &&
      mode !== "unauthorized" &&
      mode !== "rate_limit" &&
      mode !== "timeout" &&
      mode !== "duplicate"
    )
      return json(response, 400, { error: "unsupported test control" });
    state.control = { mode, path: typeof payload.path === "string" ? payload.path : null };
    return json(response, 200, state.control);
  }
  if (url.pathname === "/oauth/authorize" && request.method === "GET") {
    const redirectUri = url.searchParams.get("redirect_uri");
    if (!redirectUri) return json(response, 400, { error: "redirect_uri is required" });
    let callback: URL;
    try {
      callback = new URL(redirectUri);
    } catch {
      return json(response, 400, { error: "redirect_uri must be absolute" });
    }
    callback.searchParams.set("code", `fake-code-${identity}`);
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.statusCode = 302;
    response.setHeader("Location", callback.toString());
    response.end();
    return;
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    const payload = await body(request);
    const code = String(payload.code ?? "");
    const tokenIdentity: FakeIdentity | null =
      code === "fake-code-adam" ? "adam" : code === "fake-code-chelsea" ? "chelsea" : null;
    if (!tokenIdentity) return json(response, 401, { error: "invalid_grant" });
    return json(response, 200, {
      access_token: `fake-access-${tokenIdentity}`,
      refresh_token: `fake-refresh-${tokenIdentity}`,
      expires_in: 3600,
    });
  }
  if (url.pathname.startsWith("/v1/")) {
    await handleApi(state, request, response, url);
    return;
  }
  json(response, 404, { error: "not_found" });
}

export function startFakeYnabServer(options: FakeServerOptions = {}): { server: Server; origin: string } {
  const port = validPort(options.port ?? FAKE_PORT);
  const identity = options.identity ?? "adam";
  const origin = `http://127.0.0.1:${port}`;
  const state = createState();
  const server = createServer((request, response) => {
    void handle(state, origin, identity, request, response, options.onReset).catch(() =>
      json(response, 500, { error: "fake service failure" }),
    );
  });
  server.listen(port, "127.0.0.1");
  return { server, origin };
}

if (process.argv[1]?.endsWith("fake-ynab-server.ts")) {
  const { server } = startFakeYnabServer();
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}
