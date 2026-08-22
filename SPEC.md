# Application specification

This is the application-level behavioral contract for YNAB Splits. Setup,
deployment, backup, credentials, and operational safety remain in
[README.md](README.md).

## System specifications

- [Domain ledger and settlement](app/domain/SPEC.md)
- [Services, OAuth, YNAB, and orchestration](app/services/SPEC.md)
- [SQLite persistence](app/db/SPEC.md)
- [Route shell and interactions](app/routes/SPEC.md)
- [2026 legacy importer](app/importer/SPEC.md)

## Scope and invariants

- YNAB Splits is a private, server-rendered household ledger. A household has
  two distinct members (`adam` and `chelsea`); each member authenticates as
  their own user and connects their own YNAB account.
- Shared ledger facts are the household-safe date, description, amount, payer,
  and both member shares. YNAB plan, account, category, and transaction
  identifiers remain member-private and must not appear in the other member's
  shared view.
- Local amounts are positive integer minor units. Every ledger entry has exactly
  one share for each member, both shares are non-negative, and their sum equals
  the entry amount. YNAB milliunits are used only at the integration boundary.
- A source transaction is saved only after the member has reviewed a bound
  source snapshot. Deleted and transfer transactions are ineligible; a changed
  source is stale and must be reviewed again rather than blindly updated.
- Remote work is recoverable. A deterministic import ID and read-back check
  distinguish succeeded, failed, conflict, and pending outcomes; retries are
  owner-scoped and must not blindly repeat an uncertain write.
- A settlement consumes each eligible entry at most once. Voided entries do not
  contribute to debt. A zero-net period closes without a YNAB posting.

## Ordered member workflow

1. A member connects a personal YNAB account through the server-side OAuth
   flow. The callback establishes a local session and sends an un-onboarded
   user to onboarding.
2. The first member creates the two-person household. The other member follows
   a one-use invite, connects a distinct YNAB identity, and joins the same
   household.
3. Each member configures only their own plan, source accounts, settlement
   account, Splitting category, currency precision, settlement mode, and
   category mappings. A plan change resets that member's dependent selections
   only and remains blocked while that member has unresolved postings.
4. The member reviews eligible transactions in the inbox, chooses an equal,
   percentage, or exact split, and decides whether to update the reviewed YNAB
   source. A stale, deleted, transfer, or unsupported source remains
   ledger-only or requires fresh review.
5. The shared ledger shows household-safe facts and debt. Source identifiers,
   manual instructions, and YNAB posting controls remain owner-only.
6. A member selects an inclusive range of eligible unsettled entries, confirms
   that payment occurred, and may create an independent simple or detailed
   YNAB copy. A zero-net range closes without a remote copy.
7. Pending, failed, stale, conflicting, and read-back-mismatched work remains
   visible. Owner retries reconcile by deterministic identity and read-back;
   settlement void and restore actions preserve audit history and require the
   documented confirmation or eligibility conditions.

- Loaders, actions, authentication, encrypted connection data, external YNAB
  calls, and SQLite access remain server-side in the SSR Node application.
- Browser code does not hold OAuth tokens or provide a compatibility path for
  the removed prototype surface.
- Application and migration processes receive an explicit `DATABASE_PATH`.
- The importer requires a development or production environment name and
  resolves the selected path from its matching environment file or an
  explicitly injected fallback.
- Development and production paths are separate; the application does not infer
  or silently share a database between them.
- The supported development and production process is the repository's Node
  and pnpm workflow with persistent SQLite storage. Operational setup,
  callback registration, backups, and credentials remain specified in
  [README.md](README.md), not duplicated here.
- Focused domain, database, service, route, importer, and fake-service browser
  tests are the executable examples for this contract. Verification uses
  temporary databases and test-only OAuth/YNAB services; it never uses
  operational SQLite files, real credentials, or real remote financial writes.
- A behavior change is complete only when its specification, focused tests, and
  implementation agree. Run the focused boundary first, then the applicable
  repository checks and actual-surface smoke or end-to-end path.

### Development instance isolation

- Each development process has a validated instance ID/slug. Its HTTP
  origin/port, SQLite path, signing and encryption secrets, auth/OAuth cookie
  namespace, and fake OAuth/YNAB endpoint are instance-scoped, so distinct
  instances can run concurrently without sharing runtime state.
- Startup fails closed for an invalid ID, an origin/port collision, or a
  database whose recorded owner ID differs from the requested instance. A
  database owned by one instance is never silently reused, migrated, or
  overwritten by another.
- Instance identity is runtime and fixture metadata only; it does not enter
  household, membership, ledger, or other product-domain state. The
  development launcher and fixtures use disposable state, and fake-service
  state is isolated per run. OAuth/API origin overrides are test-only.
- Production remains unchanged: it requires an explicit `DATABASE_PATH` and
  uses real YNAB OAuth/API origins by default. Development instance defaults
  never select production data or endpoints.
- Same-host auth and OAuth cookies are namespaced by instance. Development
  runs never expose secrets or perform real YNAB writes.

## Operational handoff contract

This section specifies the safety contract for the live
[remaining-transactions handoff](YNAB_REMAINING_TRANSACTIONS_HANDOFF.md). The
handoff remains the exact execution manifest. Its live plan, worksheet,
category, transaction, row, and payload identifiers are intentionally not
copied into this product specification.

- The handoff must not be reinterpreted, reclassified, expanded, or executed
  until the user explicitly authorizes execution. Its scope is closed: do not
  touch an unapproved transaction absent from the manifest. Match remote
  transactions by stable transaction ID, never by sort order or payee text.
  Preserve every existing date, amount, account, memo, and cleared state.
  YNAB amounts remain integer milliunits.
- Before any write batch, refresh the live resources and compare the current
  state with the manifest. Archive the exact before-state and intended request,
  run and save a separate dry run, apply only that archived request, then save
  the API result and read-back verification separately.
- The baseline phase is an all-or-nothing gate. Every manifest transaction must
  still exist, remain unapproved, and retain its listed date, amount, and other
  immutable identifying fields. The expected last populated row must still
  match. Any mismatch stops execution without writes; append positions and
  corresponding read-only formulas must be recalculated before an authorized
  resumption.
- Spreadsheet preparation writes only the exact appended values to the
  writable transactions worksheet, using numeric values with the specified
  insertion mode. Hidden columns remain untouched. The split-view worksheet is
  read-only. Source cells and all corresponding split-view formula results must
  be read back without errors and must match the manifest's expected values
  before any YNAB write.
- Single-category application changes only the category and approval state.
  Split application uses the exact integer-milliunit subtransactions and
  approval state. Each read-back must confirm unchanged dates, amounts,
  accounts, memos, cleared state, and other protected fields, complete
  categories, valid parent/subtransaction totals, expected split-view amounts,
  and approval.
- Transfer repair is not spending categorization and is not added to the
  worksheet. Both existing sides are archived first; the debit update is
  dry-run and read back until the generated linked counterpart exactly matches
  the manifest in date, opposite equal amount, account, reciprocal link, and
  approval. Only then may the old unlinked duplicate be deleted and verified
  deleted. A missing or mismatched counterpart aborts before deletion.
- Final verification re-fetches live state and confirms that all manifest work
  is resolved or explicitly recorded as the manifest's manual exception; linked
  transfer sides remain approved, the duplicate is deleted, the exact appended
  worksheet rows remain present, split formulas still match the archived
  baseline, and no read-only or unrelated worksheet was written. The final
  verification artifact records counts, failed checks, and resulting
  identifiers without changing the manifest.
- Abort recovery preserves every archived before-state, proposal, dry-run,
  result, and read-back artifact. A stopped batch is not retried blindly:
  investigate the reported drift or remote outcome, obtain explicit
  authorization to resume, and repeat the manifest's precondition checks.

The handoff is an operational execution contract, not a product behavior
implementation. Product code and tests must not embed its live identifiers or
row payloads.

## Plan-to-system boundaries

The original household-splitting plan maps to current owning systems rather
than to one specification per plan bullet:

- Domain allocation, money, debt, settlement previews, and posting targets:
  [app/domain/SPEC.md](app/domain/SPEC.md).
- SQLite schema, migration, atomicity, ownership, and idempotency:
  [app/db/SPEC.md](app/db/SPEC.md).
- OAuth, onboarding orchestration, settings, inbox review, YNAB gateway
  outcomes, and settlement recovery:
  [app/services/SPEC.md](app/services/SPEC.md).
- Route composition, accessibility, feedback, and user-visible recovery:
  [app/routes/SPEC.md](app/routes/SPEC.md).
- CSV parsing, dry-run classification, atomic apply, and legacy idempotency:
  [app/importer/SPEC.md](app/importer/SPEC.md).

The current implementation and tests take precedence over plan-only
implementation choices. The plan's removed prototype files, unused libraries,
and unconfigured coverage targets are not application requirements.

## Acceptance criteria

1. A household member can complete the ordered workflow from OAuth through
   settlement recovery without crossing the other member's ownership boundary.
2. A household member can see shared ledger facts but not the other member's
   YNAB identifiers or owner-only controls.
3. Invalid totals, shares, member identities, dates, descriptions, or currency
   precision are rejected rather than normalized into ledger state.
4. A stale, conflicting, or indeterminate external result remains visible as a
   reviewable outcome; no success is inferred without matching read-back.
5. The same behavior is represented by a focused test and the implementation
   path listed below.
6. Two validated development instances with different IDs can run concurrently
   on distinct origins/ports, and each uses only its own path, secrets, and
   fake-service endpoint.
7. Same-host auth and OAuth cookies from one instance are not accepted by
   another instance.
8. An instance cannot open a database owned by a different instance ID, and an
   origin/port collision is rejected before product data is read or written.
9. Each E2E run has isolated fake OAuth/API state and configurable ports; one
   run cannot observe another run's fake-service state.
10. Development harnesses expose no secrets and perform no real YNAB writes;
    production still requires explicit database selection and real origins.
11. Instance IDs and runtime metadata never enter household, membership, ledger,
    or other product-domain state; no agent/worktree concept is persisted.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Household identity, sessions, and ownership | `app/services/request.server.ts`, `app/services/session.server.ts`, `app/db/database.server.ts` | `app/services/request.server.test.ts`, `app/db/database.test.ts`, `e2e/app.spec.ts` |
| Shared projection and private identifiers | `app/services/ledger-query.server.ts`, `app/routes/ledger.tsx`, `app/routes/ledger-entry.tsx` | `app/services/ledger-query.test.ts`, `e2e/app.spec.ts`, `e2e/navigation.spec.ts` |
| Integer money and currency boundary | `app/domain/money.ts`, `app/services/settings.server.ts` | `app/domain/money.test.ts`, `app/services/settings.test.ts` |
| Source review, stale/conflict/pending outcomes | `app/services/inbox-orchestration.server.ts`, `app/services/ynab-verification.server.ts` | `app/services/inbox-orchestration.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/action-feedback.spec.ts` |
| Settlement eligibility and lifecycle | `app/routes/settlement-new.tsx`, `app/routes/settlement-detail.tsx`, `app/domain/settlement.ts` | `app/domain/settlement.test.ts`, `e2e/settlement-interactions.spec.ts` |
| SQLite lifecycle and atomic persistence | `app/db/database.server.ts`, `app/db/ledger-repository.server.ts` | `app/db/database.test.ts`, `app/db/migration-behavior.test.ts`, `app/db/ledger-repository.test.ts` |
| Route shell, navigation, and feedback | `app/routes.ts`, `app/routes/app-layout.tsx`, `app/navigation.ts`, `app/components/QuickNavigation.tsx`, `app/components/ActionFeedback.tsx` | `app/navigation.test.ts`, `e2e/navigation.spec.ts`, `e2e/action-feedback.spec.ts` |
| Development runtime instance isolation | `scripts/dev-instance.ts`, `scripts/dev-seed.ts`, `scripts/dev-reset.ts`, `app/services/env.server.ts`, `app/services/session.server.ts`, `app/services/auth.server.ts`, `app/services/ynab.server.ts`, `app/db/database.server.ts`, `app/routes/dev-health.tsx`, `app/routes/app-layout.tsx` | `app/services/env.test.ts`, `app/db/database.test.ts`, `e2e/test-server.ts`, `e2e/fake-ynab-server.ts`, `e2e/fake-fetch.mjs`, `playwright.config.ts` |

The implementation and tests above are the current evidence for this
specification; README remains authoritative for non-behavioral operations.

