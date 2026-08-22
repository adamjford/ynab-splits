import { chmodSync, existsSync, readFileSync, writeFileSync, renameSync, lstatSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { type Server } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getInstancePaths, resetInstanceDatabase, validateInstanceId } from "./dev-reset";
import { startFakeYnabServer, type FakeIdentity } from "../e2e/fake-ynab-server";

const LOOPBACK = "127.0.0.1";
const DEFAULT_IDENTITY: FakeIdentity = "adam";
const FAKE_CLIENT_ID = "dev-fake-client-id";
const FAKE_CLIENT_SECRET = "dev-fake-client-secret";
export type LauncherOptions = {
  id: string;
  label?: string;
  port?: number;
  fakePort?: number;
  identity?: FakeIdentity;
};

type PersistedSecrets = {
  sessionSecret: string;
  tokenEncryptionKey: string;
};

type InstanceMetadata = {
  version: 1;
  id: string;
  label: string;
  appPort: number;
  fakePort: number;
  appOrigin: string;
  fakeOrigin: string;
  databasePath: string;
  createdAt: string;
  updatedAt: string;
};

function parsePort(value: string, option: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${option} must be an integer between 1 and 65535`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`${option} must be an integer between 1 and 65535`);
  return port;
}

function parseIdentity(value: string): FakeIdentity {
  if (value !== "adam" && value !== "chelsea") throw new Error("--identity must be adam or chelsea");
  return value;
}

export function parseArgs(argv: string[]): LauncherOptions {
  let id: string | undefined;
  let label: string | undefined;
  let port: number | undefined;
  let fakePort: number | undefined;
  let identity: FakeIdentity = DEFAULT_IDENTITY;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === "--id") id = next();
    else if (arg.startsWith("--id=")) id = arg.slice("--id=".length);
    else if (arg === "--label") label = next();
    else if (arg.startsWith("--label=")) label = arg.slice("--label=".length);
    else if (arg === "--port" || arg === "--app-port") port = parsePort(next(), arg);
    else if (arg.startsWith("--port=") || arg.startsWith("--app-port=")) port = parsePort(arg.slice(arg.indexOf("=") + 1), "--port");
    else if (arg === "--fake-port") fakePort = parsePort(next(), arg);
    else if (arg.startsWith("--fake-port=")) fakePort = parsePort(arg.slice("--fake-port=".length), "--fake-port");
    else if (arg === "--identity") identity = parseIdentity(next());
    else if (arg.startsWith("--identity=")) identity = parseIdentity(arg.slice("--identity=".length));
    else if (arg === "--" || arg === "") continue;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!id) throw new Error("usage: pnpm dev:instance -- --id <instance-id> [--port <port>] [--fake-port <port>]");
  const validatedId = validateInstanceId(id);
  if (port !== undefined && fakePort !== undefined && port === fakePort) throw new Error("app and fake-service ports must differ");
  return { id: validatedId, label: label?.trim() || validatedId, port, fakePort, identity };
}

function readSecrets(path: string): PersistedSecrets | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("instance secrets file is not valid JSON; refusing to replace it");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("instance secrets file is malformed");
  const value = parsed as Record<string, unknown>;
  if (typeof value.sessionSecret !== "string" || value.sessionSecret.length < 32 || typeof value.tokenEncryptionKey !== "string" || value.tokenEncryptionKey.length !== 32) {
    throw new Error("instance secrets file is malformed");
  }
  return { sessionSecret: value.sessionSecret, tokenEncryptionKey: value.tokenEncryptionKey };
}

function writePrivateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function ensureSecrets(path: string): PersistedSecrets {
  const existing = readSecrets(path);
  if (existing) return existing;
  const secrets = {
    sessionSecret: randomBytes(32).toString("hex"),
    tokenEncryptionKey: randomBytes(16).toString("hex"),
  } satisfies PersistedSecrets;
  writePrivateJson(path, secrets);
  return secrets;
}

function ensureNoSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`refusing symlinked instance file: ${path}`);
}

async function freeLoopbackPort(preferred?: number): Promise<number> {
  const server = createServer();
  return await new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address() as AddressInfo | null;
      const port = address?.port;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("failed to allocate a loopback port"));
        else resolve(port);
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(preferred ?? 0, LOOPBACK);
  });
}
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function terminateChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

export async function runInstance(options: LauncherOptions): Promise<number> {
  const id = validateInstanceId(options.id);
  const label = options.label?.trim() || id;
  const identity = options.identity ?? DEFAULT_IDENTITY;
  const paths = getInstancePaths(id);
  ensureNoSymlink(paths.database);
  ensureNoSymlink(paths.metadata);
  ensureNoSymlink(paths.secrets);
  const secrets = ensureSecrets(paths.secrets);
  const appPort = await freeLoopbackPort(options.port);
  let fakePort = await freeLoopbackPort(options.fakePort);
  while (fakePort === appPort) fakePort = await freeLoopbackPort();

  const fake = startFakeYnabServer({
    port: fakePort,
    identity,
    onReset: () => resetInstanceDatabase(id),
  });
  const appOrigin = `http://${LOOPBACK}:${appPort}`;
  const now = new Date().toISOString();
  const previous = existsSync(paths.metadata) ? JSON.parse(readFileSync(paths.metadata, "utf8")) as Partial<InstanceMetadata> : null;
  const metadata: InstanceMetadata = {
    version: 1,
    id,
    label,
    appPort,
    fakePort,
    appOrigin,
    fakeOrigin: fake.origin,
    databasePath: paths.database,
    createdAt: typeof previous?.createdAt === "string" ? previous.createdAt : now,
    updatedAt: now,
  };
  writePrivateJson(paths.metadata, metadata);

  const child = spawn("pnpm", ["dev", "--host", LOOPBACK, "--port", String(appPort)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      APP_ORIGIN: appOrigin,
      DATABASE_PATH: paths.database,
      INSTANCE_ID: id,
      INSTANCE_LABEL: label,
      COOKIE_PREFIX: `ynab_splits_${id}`,
      YNAB_API_ORIGIN: `${fake.origin}/v1`,
      YNAB_OAUTH_ORIGIN: fake.origin,
      SESSION_SECRET: secrets.sessionSecret,
      TOKEN_ENCRYPTION_KEY: secrets.tokenEncryptionKey,
      YNAB_CLIENT_ID: FAKE_CLIENT_ID,
      YNAB_CLIENT_SECRET: FAKE_CLIENT_SECRET,
      HOST: LOOPBACK,
      PORT: String(appPort),
    },
  });
  console.log(`Development instance ${id} (${label}) at ${appOrigin}; fake YNAB at ${fake.origin}; database ${paths.database}`);

  let stopping = false;
  const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await terminateChild(child);
    await closeServer(fake.server);
    if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  const onSignal = (): void => { void shutdown("SIGTERM"); };
  const onInterrupt = (): void => { void shutdown("SIGINT"); };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onInterrupt);
  const childExit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("error", () => resolve({ code: 1, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await shutdown();
  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onInterrupt);
  return childExit.code ?? (childExit.signal ? 1 : 0);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runInstance(parseArgs(argv));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
