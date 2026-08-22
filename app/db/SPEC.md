# SQLite persistence specification

This system owns durable household state, migration safety, transaction
boundaries, and idempotency. Application-wide privacy and recovery invariants
are in [../../SPEC.md](../../SPEC.md). Domain value rules are in
[../domain/SPEC.md](../domain/SPEC.md); authenticated orchestration is in
[../services/SPEC.md](../services/SPEC.md).

## Database lifecycle and integrity

- Opening a database enables foreign-key enforcement and applies ordered schema
  migrations. Reopening an already-current database is idempotent.
- A migration either completes as a unit or leaves the database at its prior
  valid schema. A failed migration closes its failed connection and reports the
  migration failure; it must not expose a partially upgraded database.
- Database validation checks SQLite integrity, foreign-key integrity, and every
  ledger share group. Corrupt or incomplete state is rejected before normal
  application work continues.
- Persistent databases use SQLite WAL behavior. Tests and smoke checks use a
  fresh temporary or in-memory database, never the operational database.

## Development instance ownership
- Runtime ownership is stored in the `runtime_metadata` table under the
  `database_owner` key, not in household, membership, ledger, or other
  product tables. The v4 owner metadata migration is applied after legacy
  v1/v2/v3 databases are baselined, so each legacy schema reaches the current
  version before ownership is checked.
- `createDatabase(filename, ownerId?)` accepts an optional runtime owner ID.
  Instance-aware request access supplies `env.INSTANCE_ID`; direct callers that
  omit the owner remain compatible.
- The first owner-aware open records the owner ID. A later open with a
  different owner fails closed before normal reads or writes; reopening with the
  same owner succeeds. An owner mismatch must not migrate, overwrite, or
  expose product state.
- Instance IDs are runtime/fixture identity only. They never become product
  records or agent/worktree columns.

## Household ownership and stored identities

- A user has one stable YNAB identity and one chosen display name. A household
  has exactly the two member keys `adam` and `chelsea`; membership uniqueness
  prevents a user or member key from being attached twice.
- OAuth connection data is owned by one user and stores encrypted tokens only.
  Plan settings, source accounts, category assignments, manual tasks, and YNAB
  decisions are likewise owner-scoped. Shared ledger projections must not be
  reconstructed by joining another member's private YNAB identifiers.
- Ledger entries retain household-safe facts and optional source identity,
  snapshot, legacy key, and correction link. Source decision uniqueness is
  `(user_id, plan_id, ynab_transaction_id)`; a repeated decision cannot create a
  second local source record.

## Ledger atomicity and invariants

- Inserting a ledger entry and its shares is one atomic operation. Invalid
  member identities, duplicate members, negative shares, missing households,
  invalid totals, or share sums that differ from the parent amount leave no
  parent or child rows behind.
- Every persisted entry has exactly one non-negative share for `adam` and one
  for `chelsea`, including an allowed zero share. The positive integer shares
  sum exactly to the positive integer parent amount.
- Parent and share identity is protected: a share cannot be duplicated, deleted,
  or reassigned in a way that leaves an incomplete entry. Foreign-key failures
  roll back the complete insert rather than leaving an orphan.

## Idempotency and remote-work records

- Legacy import keys are unique. Reapplying unchanged input skips the existing
  unit instead of duplicating it.
- Manual YNAB tasks have exactly the statuses `action_needed`, `verified`, and
  `dismissed`. A decision can have at most one `action_needed` task while
  retaining completed task history.
- Settlement postings have exactly the statuses `pending`, `succeeded`,
  `conflict`, `failed`, and `skipped`. A settlement has at most one posting for
  each owner, and every posting import ID is unique. Intended targets,
  sanitized read-back data, remote IDs, and last errors are retained for
  recovery; OAuth tokens are never stored in these records.
- An active settlement item links an entry at most once. Voiding a settlement
  records the unlink state so the entry can become eligible again without
  deleting audit history. A new active settlement cannot silently reuse an
  active item.

## Acceptance criteria

1. Database creation and current-version reopen enforce foreign keys, preserve
   migration order, and validate integrity before serving requests.
2. A failed migration or invalid ledger insert leaves no partial schema, parent,
   share, or orphan rows.
3. Valid zero-share and odd-share entries persist with exactly one Adam and one
   Chelsea share whose sum equals the parent amount.
4. Duplicate source decisions, action-needed manual tasks, legacy imports,
   active settlement items, and per-owner settlement postings are rejected or
   skipped according to their idempotency boundary.
5. Remote-work records expose recoverable status and read-back evidence without
   exposing credentials.
6. An owner-aware reopen succeeds for the same ID and fails before product
   reads/writes for a different ID; omitting the owner remains supported.
7. Legacy v1/v2/v3 databases baseline before the owner metadata migration, and
   runtime owner metadata remains outside product-domain tables.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Database creation, migrations, integrity, and foreign keys | `app/db/database.server.ts` | `app/db/database.test.ts`, `app/db/migration-behavior.test.ts` |
| Runtime instance ownership and metadata migration | `app/db/database.server.ts`, `app/services/request.server.ts`, `app/services/env.server.ts` | `app/db/database.test.ts`, `app/db/migration-behavior.test.ts`, `app/services/request.server.test.ts` |
| Atomic ledger parent/share persistence | `app/db/ledger-repository.server.ts` | `app/db/ledger-repository.test.ts` |
| Decision, manual-task, settlement-item, and posting uniqueness | `app/db/database.server.ts`, `app/db/migration-behavior.test.ts` | `app/db/database.test.ts`, `app/db/migration-behavior.test.ts` |
| Household and owner-scoped persistence | `app/db/database.server.ts`, `app/services/request.server.ts` | `app/db/database.test.ts`, `app/services/request.server.test.ts`, `e2e/app.spec.ts` |
