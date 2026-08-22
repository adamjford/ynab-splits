# YNAB Splits

YNAB Splits is a private, server-rendered household ledger. Each household member connects their own YNAB account, reviews source transactions, records an integer-minor-unit split, and can prepare or post an optional settlement copy. Shared ledger facts are separate from member-owned YNAB identifiers and posting controls.

This is a stateful Node application backed by SQLite. It is not a static site and must not be deployed to GitHub Pages.

## Architecture

- React Router 8 with SSR enabled in `react-router.config.ts`.
- Vite builds the browser assets and server bundle. The production server entry is `build/server/index.js` and is served by `react-router-serve`.
- Route modules live in `app/routes/`: OAuth start/callback, onboarding and invites, dashboard, inbox, ledger, YNAB settings, and settlement workflows.
- Server-only services in `app/services/` own OAuth, encrypted token storage, YNAB HTTP calls, settings, and request authentication.
- `better-sqlite3` is the persistence layer. The application opens the database through `createDatabase`; migrations and integrity checks run through `pnpm db:migrate`.
- Local money is represented as integer minor units. Conversion to YNAB integer milliunits happens only at the YNAB boundary.

## Requirements

Use the versions declared by the repository:

- Node.js 22.22.0 or newer
- pnpm 11.21.0
- A YNAB OAuth application for a real connection

Docker is intentionally not required or supported by the development workflow. The application is a normal Node process and can run on a small host with persistent local storage.

## Local setup

```bash
git clone <repository-url>
cd ynab-splits
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The development server listens on `HOST` and `PORT` (by default `0.0.0.0:3000`). Keep `.env`, SQLite files, WAL files, CSV exports, and generated handoff material out of Git. The repository's ignore rules include environment files, database files, CSVs, and `/YNAB_*_HANDOFF.md`.

### Environment

`.env.example` documents every required variable:

- `APP_ORIGIN`: the browser-visible origin, including scheme and port, for example `http://localhost:3000`.
- `DATABASE_PATH`: persistent SQLite path, normally under `./data/`.
- `SESSION_SECRET`: at least 32 random UTF-8 bytes. Generate a 64-byte hexadecimal value with `openssl rand -hex 32`.
- `TOKEN_ENCRYPTION_KEY`: exactly 32 bytes in the current raw-key format. Generate it with `openssl rand -hex 16`.
- `YNAB_CLIENT_ID` and `YNAB_CLIENT_SECRET`: credentials from the YNAB developer console.
- `HOST` and `PORT`: bind address and HTTP port.

Do not use the sample values from `.env.example` in a running environment. Treat both secrets and the YNAB client secret as production credentials; never paste them into issues, logs, fixtures, or browser tests.

### OAuth callback

Register this exact callback URL in the YNAB OAuth application, using the same origin as `APP_ORIGIN`:

```text
${APP_ORIGIN}/auth/ynab/callback
```

The application uses the authorization-code flow with PKCE. It redirects to YNAB at `/oauth/authorize`, exchanges the code at `/oauth/token`, encrypts the returned tokens before storing them, and establishes an HttpOnly session cookie. A later reauthorization clears a prior disconnected marker for that user.

### WSL2 and LAN access

For a browser running on Windows, `http://localhost:3000` normally reaches a WSL2 development server. For another device on the mirrored/local network:

1. Keep `HOST=0.0.0.0` and determine the WSL/Windows host address reachable by that device.
2. Set `APP_ORIGIN` to the exact address and port the device uses, such as `http://192.0.2.10:3000`.
3. Register the corresponding callback URL with YNAB.
4. Allow the port through the host firewall if needed.

The OAuth/session cookie policy derives `Secure` from HTTPS, so local HTTP remains supported for development. If YNAB or a deployment policy requires HTTPS, put native Caddy in front of the Node server with `tls internal`, trust its local CA on each client, update `APP_ORIGIN` to the HTTPS origin, and register the HTTPS callback. Do not use a public tunnel for this private application.

## Application workflow

1. **Connect YNAB.** Start at `/auth/ynab/start`; complete the OAuth flow and return through `/auth/ynab/callback`.
2. **Onboard or invite.** The first member creates the household and can create a one-use invite. The second member follows `/invite/:token`, connects their own YNAB account, and joins the household.
3. **Configure YNAB.** In `/settings/ynab`, each member chooses their own plan, source account, settlement account, currency precision, posting mode, Splitting category, and category mappings. YNAB plan/account/category IDs remain member-private.
4. **Review the inbox.** `/inbox` filters the selected source account to eligible transactions. Review the immutable source snapshot, choose equal, percentage, or exact sharing, and decide whether a source update should be prepared. A stale or ineligible source must be reviewed again rather than blindly updated.
5. **Use the shared ledger.** `/ledger` shows the household-safe date, description, amount, payer, and two member shares. `/ledger/:entryId` exposes owner-only manual verification and posting controls; the other member sees shared facts only.
6. **Settle a period.** `/settlements/new` selects the inclusive date range of unsettled entries and requires acknowledgement that payment occurred. A zero-net period closes without a YNAB posting. Optional member-owned copies can be prepared in simple or detailed mode; each copy has an independent pending/succeeded/conflict/failed/skipped lifecycle.
7. **Recover safely.** Retry only from the owner session. Pending or failed copies are reconciled by deterministic import ID and readback; a mismatch is a conflict requiring review. A closed settlement may be voided with explicit confirmation and can be restored only while its original entries remain eligible.

### Keyboard and quick navigation

The authenticated shell keeps the **Navigate** control visible for pointer discovery. Activate it to open the navigation palette, then filter destinations by label or keyword and activate a result with the keyboard or pointer. The exact shortcuts are **Ctrl+K** on Windows/Linux and **Command+K** on macOS; other modifier combinations are ignored, and editable fields keep their normal shortcut behavior.

Every authenticated top-level route must be registered in `APP_DESTINATIONS` (`app/navigation.ts`). The registry supplies the shell links, current-section state, and Navigate palette coverage; adding a route without registering it leaves those surfaces incomplete.

## Database operations

The application uses SQLite in WAL mode. Stop application writers before making an operational backup or restore.

```bash
# Apply the ordered schema migrations to the configured database
pnpm db:migrate

# Optional maintenance with the sqlite3 CLI, while the app is stopped
sqlite3 "$DATABASE_PATH" 'PRAGMA wal_checkpoint(TRUNCATE);'
sqlite3 "$DATABASE_PATH" ".backup '${DATABASE_PATH}.backup'"
```

Keep the database backup together with any WAL state until the backup has been checked. To restore, stop the server, move the current database aside, copy the reviewed backup into `DATABASE_PATH`, remove stale `-wal`/`-shm` files only when you have confirmed they belong to the replaced database, run `pnpm db:migrate`, and run the application's integrity checks before reopening traffic. Never experiment on the live operational file; use a copy first.

Loss of `TOKEN_ENCRYPTION_KEY` makes stored YNAB tokens unrecoverable. Restore the matching secret from the deployment secret store or backup; otherwise remove/recreate only the affected connection and require OAuth reauthorization. Do not attempt to decrypt or print tokens manually. A disconnected connection must be reauthorized before its owner can retry YNAB work.

## 2026 legacy importer

The importer consumes the two CSV exports separately, requires an explicit household ID, and requires `DATABASE_PATH` even for dry runs:

```bash
DATABASE_PATH=./data/import-test.sqlite pnpm import:2026 -- \
  --transactions /path/to/transactions.csv \
  --split-view /path/to/split-view.csv \
  --household <local-household-id>
```

Without `--apply`, the command is a dry run: it parses and validates the 2026 rows and reports the period/transfer summary without writing the database. After reviewing that output, apply to a temporary or backed-up database with:

```bash
DATABASE_PATH=./data/import-test.sqlite pnpm import:2026 -- \
  --transactions /path/to/transactions.csv \
  --split-view /path/to/split-view.csv \
  --household <local-household-id> \
  --apply
```

Use representative copies first. The importer preserves recorded workbook shares and transfer values; it must not invent an adjustment for a signed mismatch. A rerun of an unchanged import is expected to be idempotent. CSV exports and handoff artifacts are user data and must remain outside Git.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` uses `playwright.config.ts` and is intended for a local fake OAuth/YNAB service or a test-only server, never real YNAB credentials or a real household database. The push/pull-request workflow installs Chromium when browser tests are present and runs lint, typecheck, coverage, and the production build with frozen pnpm dependencies.

For a production smoke check, build and run against a temporary database and test-only credentials:

```bash
pnpm build
DATABASE_PATH=./data/smoke.sqlite pnpm start
```

Do not point smoke tests, importer checks, or browser tests at the operational database or a real YNAB plan.

## Production operation

Build on the target Node/pnpm versions and run the generated server bundle with a persistent `DATABASE_PATH`:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm start
```

Terminate writers before backup/checkpoint/restore. Monitor failed, conflicted, and pending owner postings from the application; do not resolve a conflict by repeating a remote write blindly. Preserve local audit records when remote cleanup after a void is manual. Keep HTTPS termination, firewall rules, process supervision, and secret storage outside the application process, and grant the process access only to its data directory and environment secrets.
