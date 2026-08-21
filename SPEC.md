# Application specification

This is the application-level behavioral contract for YNAB Splits. Setup,
deployment, backup, credentials, and operational safety remain in
[README.md](README.md).

## System specifications

- [Domain ledger and settlement](app/domain/SPEC.md)
- [Services, OAuth, YNAB, and orchestration](app/services/SPEC.md)
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

## Acceptance criteria

1. A household member can see shared ledger facts but not the other member's
   YNAB identifiers or owner-only controls.
2. Invalid totals, shares, member identities, dates, descriptions, or currency
   precision are rejected rather than normalized into ledger state.
3. A stale, conflicting, or indeterminate external result remains visible as a
   reviewable outcome; no success is inferred without matching read-back.
4. The same behavior is represented by a focused test and the implementation
   path listed below.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Household identity, sessions, and ownership | `app/services/request.server.ts`, `app/services/session.server.ts`, `app/db/database.server.ts` | `app/services/request.server.test.ts`, `app/db/database.test.ts`, `e2e/app.spec.ts` |
| Shared projection and private identifiers | `app/services/ledger-query.server.ts`, `app/routes/ledger.tsx`, `app/routes/ledger-entry.tsx` | `app/services/ledger-query.test.ts`, `e2e/app.spec.ts`, `e2e/navigation.spec.ts` |
| Integer money and currency boundary | `app/domain/money.ts`, `app/services/settings.server.ts` | `app/domain/money.test.ts`, `app/services/settings.test.ts` |
| Source review, stale/conflict/pending outcomes | `app/services/inbox-orchestration.server.ts`, `app/services/ynab-verification.server.ts` | `app/services/inbox-orchestration.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/action-feedback.spec.ts` |
| Settlement eligibility and lifecycle | `app/routes/settlement-new.tsx`, `app/routes/settlement-detail.tsx`, `app/domain/settlement.ts` | `app/domain/settlement.test.ts`, `e2e/settlement-interactions.spec.ts` |

The implementation and tests above are the current evidence for this
specification; README remains authoritative for non-behavioral operations.
