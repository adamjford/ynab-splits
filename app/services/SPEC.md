# Services, OAuth, YNAB, and orchestration specification

This system owns authenticated request handling, member-owned YNAB
connections/settings, inbox orchestration, shared projections, and remote
read-back outcomes. Domain allocation and settlement value rules are in
[../domain/SPEC.md](../domain/SPEC.md). Application-wide invariants are in
[../../SPEC.md](../../SPEC.md). Operational setup, callback registration,
secrets, and safety policy remain in [README.md](../../README.md).

## Runtime database path and development instances

- Every application and migration process requires an explicit `DATABASE_PATH`;
  a missing value fails before the process opens SQLite, and no process falls
  back to an ambiguous shared path.
- The importer still requires an environment name and selects `DATABASE_PATH`
  from the matching `.env.development`/`.env` or `.env.production` file. It
  accepts an externally supplied path only when no matching file exists, and
  production never selects the development file.
- A development process requires a validated instance ID/slug. Empty,
  malformed, separator-containing, and traversal-like IDs fail before paths,
  secrets, or listeners are created.
- An instance ID derives distinct development HTTP origins and ports, a SQLite
  path, and session and token-encryption secrets.
- On the same host, two IDs must resolve to distinct paths and ports; a port or
  path collision fails rather than sharing another instance's state.
- Authentication and OAuth cookie names are instance-namespaced, so a cookie
  from one instance cannot authenticate to another.
- The database stores the instance owner ID in runtime metadata outside
  household, member, ledger, and other product-domain tables. A new database
  records its owner on first open; a matching owner reopens normally. A legacy
  database may first apply the explicit v4 owner-metadata migration, after
  which a different owner fails closed before normal product reads or writes.
  No product reads or writes occur and no owner is silently adopted.
- An unmarked or malformed owner marker requires explicit initialization for
  the current instance and is never silently adopted.
- Development and E2E fixtures may inject fake API and OAuth origins. Their
  fake service state and configurable HTTP ports are per run; the launcher and
  seed/reset helpers use separate fixture data and never the product database.
- Production retains explicit persistent `DATABASE_PATH` selection and real
  YNAB API/OAuth origins by default. Development-derived secrets, fake origins,
  and shared or implicit database paths are not production fallbacks.

## OAuth and member-owned YNAB connections

- OAuth uses authorization code plus PKCE. The callback accepts only a matching,
  unexpired state cookie and code; denial, invalid state, malformed responses,
  unauthorized responses, rate limits, timeouts, and network errors remain
  explicit failures.
- Access and refresh tokens are encrypted before persistence. A connection is
  tied to one local user; reauthorization replaces its tokens and clears the
  disconnected marker. The session then continues through onboarding.
- Each member's plan, source accounts, settlement account, Splitting category,
  currency precision, and category mappings are validated against that
  member's selected plan. The two household plans must use the same currency
  format.
- Changing plan clears only that member's dependent selections and is blocked
  while that member has unresolved postings. YNAB identifiers remain member
  private and are omitted from shared projections.

## Inbox review and shared projection

- Inbox review is bound to the authenticated user, selected plan, transaction,
  expiry, and source snapshot. A missing or invalid review proof is rejected.
- Deleted and transfer transactions cannot be saved or dismissed. A source
  changed after review is stale; the member must refresh and review it.
- A review decision is transactional and owner-scoped. Existing YNAB
  subtransactions create an owner-only manual task instead of silently
  rewriting the source.
- The shared ledger exposes date, description, amount, payer, and member
  shares. Source identifiers and manual controls remain owner-only.

## YNAB reads, writes, and verification

- The YNAB gateway is the only external boundary. Source updates and created
  settlement copies are checked against the reviewed snapshot or intended
  target after the remote operation.
- A source update that is already applied is recovered as succeeded. A source
  changed since review or a read-back mismatch is `conflict`; timeout/network
  uncertainty is `pending`; known terminal errors are `failed`.
- Settlement copies reserve a stable import ID before writing. Retry first
  reads by that ID or stored remote ID, accepts only an exact match, and
  otherwise leaves a conflict for review. Retries remain owner-scoped.
- Tests use the repository's fake OAuth/YNAB service and test-only credentials.

## Onboarding and invitations

- A successful YNAB callback creates or reuses one local user from the stable
  YNAB identity, then routes an un-onboarded user to display-name onboarding.
- The first completed onboarding creates the household and the `adam`
  membership. A member may create an invite for the other member; the invite
  is represented by a hashed random token, expires after 24 hours, and can be
  consumed only once.
- An invite route carries the token through OAuth state. Onboarding validates
  its hash and expiry inside the membership transaction, assigns the invited
  member key, consumes the invite, and rejects invalid, expired, consumed, or
  over-capacity invitations. The household cannot gain a third member.

## Source update and manual verification

- An eligible unsplit source is re-read immediately before an owner update.
  ID, date, amount, account, payee, category, approval/deletion state, and
  subtransactions must still match the reviewed snapshot.
- A matching source update preserves the parent transaction fields, writes the
  two signed categorized shares, and is accepted locally only after exact
  approval, category, and subtransaction read-back. A mismatch is a visible
  conflict.
- An already-split source is never sent through the unsupported update path.
  Instead, an owner-only manual task preserves the existing owner lines,
  replaces the counterparty Splitting line, records the normalized target, and
  becomes verified only after the owner confirms an exact order-independent
  read-back. Dismissal remains visible as a permanent owner decision.

## Settlement posting and recovery lifecycle

- Settlement creation is shared ledger state. Each member may independently
  request one optional copy using only that member's settings and connection.
  A zero-net settlement closes without creating a posting.
- A posting reserves its deterministic import identity and intended target
  before the external call. It searches by import identity or stored remote
  identity before retrying, accepts only an exact read-back, and otherwise
  remains `conflict` for review. Timeout/network uncertainty is `pending`;
  known terminal errors are `failed`; an exact existing match is `succeeded`.
- Only the posting owner may retry or skip their optional copy. Succeeded
  postings cannot be skipped, and skipped postings cannot be retried. Posting
  state is visible on the settlement to both members without exposing the
  owner's private target or connection.
- Voiding requires explicit confirmation. If any copy succeeded, the action
  also requires acknowledgement that remote cleanup is manual. Voiding marks
  the settlement voided, unlinks its entries for future eligibility, and
  preserves the posting audit record. Restore is allowed only when the
  original entries are still present and not actively linked elsewhere; a
  conflict leaves the settlement voided and visible.

## Acceptance criteria

1. A callback without valid state, code, or a valid token response cannot create
   a session or connection.
2. Persisted connections contain encrypted tokens, and reauthorization restores
   a disconnected owner without exposing credentials.
3. Invalid plan/account/category selections and cross-member currency mismatches
   are rejected before settings are committed.
4. Invalid review proofs, stale sources, and ineligible transactions remain
   reviewable without creating an unauthorized ledger state.
5. Fake-service timeout, network, stale, read-back, rate-limit, and
   unauthorized cases retain their documented pending/conflict/failed
   distinctions.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Request authentication, sessions, and ownership | `app/services/request.server.ts`, `app/services/session.server.ts` | `app/services/request.server.test.ts`, `e2e/app.spec.ts` |
| PKCE URL, token exchange, encrypted connection persistence | `app/services/auth.server.ts`, `app/routes/auth.start.tsx`, `app/routes/auth.callback.tsx`, `app/services/crypto.server.ts` | `app/services/auth.test.ts`, `app/services/crypto.test.ts`, `e2e/app.spec.ts`, `e2e/fake-ynab-server.ts` |
| Member-owned settings and plan validation | `app/services/settings.server.ts`, `app/routes/settings-ynab.tsx`, `app/services/ynab-user.server.ts` | `app/services/settings.test.ts`, `e2e/app.spec.ts`, `e2e/action-feedback.spec.ts` |
| Inbox review, source snapshots, manual tasks, and recovery | `app/services/inbox-orchestration.server.ts`, `app/services/ynab-verification.server.ts` | `app/services/inbox-orchestration.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/action-feedback.spec.ts` |
| Shared ledger query and ownership projection | `app/services/ledger-query.server.ts`, `app/routes/ledger.tsx`, `app/routes/ledger-entry.tsx` | `app/services/ledger-query.test.ts`, `e2e/app.spec.ts`, `e2e/navigation.spec.ts` |
| Gateway transport, settlement IDs, and exact read-back | `app/services/ynab.server.ts`, `app/services/ynab-verification.server.ts`, `app/services/inbox-orchestration.server.ts`, `app/domain/settlement-posting.ts`, `app/routes/settlement-detail.tsx` | `app/services/ynab-verification.test.ts`, `app/services/inbox-orchestration.test.ts`, `app/domain/settlement-posting.test.ts`, `e2e/fake-ynab-server.ts`, `e2e/action-feedback.spec.ts` |
| Onboarding, source updates, and manual verification | `app/routes/onboarding.tsx`, `app/routes/invite.tsx`, `app/services/inbox-orchestration.server.ts`, `app/services/ynab-verification.server.ts` | `app/routes/onboarding.test.tsx`, `app/services/inbox-orchestration.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/app.spec.ts` |
| Settlement posting, owner recovery, void, and restore | `app/routes/settlement-detail.tsx`, `app/domain/settlement-posting.ts`, `app/services/ynab-verification.server.ts` | `app/domain/settlement-posting.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/app.spec.ts`, `e2e/settlement-interactions.spec.ts` |

| Instance validation, per-instance environment, paths, ports, and production guards | `app/services/env.server.ts`, `scripts/dev-instance.ts`, `scripts/migrate.ts`, `scripts/import-2026.ts` | `app/services/env.test.ts`, `app/importer/legacy2026-apply.test.ts`, `e2e/app.spec.ts` |
| Instance-namespaced sessions and request ownership | `app/services/session.server.ts`, `app/services/request.server.ts` | `app/services/request.server.test.ts`, `e2e/app.spec.ts` |
| Database owner marker, mismatch failure, and migration safety | `app/db/database.server.ts`, `scripts/dev-seed.ts`, `scripts/dev-reset.ts`, `scripts/migrate.ts` | `app/db/database.test.ts`, `app/db/migration-behavior.test.ts`, `e2e/app.spec.ts` |
| Injectable API/OAuth origins and isolated fake-service ports/state | `app/services/auth.server.ts`, `app/services/ynab.server.ts`, `e2e/fake-fetch.mjs`, `e2e/fake-ynab-server.ts`, `e2e/test-server.ts` | `app/services/auth.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/app.spec.ts`, `e2e/action-feedback.spec.ts` |

The dedicated auth tests exercise the injected OAuth transport and encrypted
connection persistence without contacting real external services.
