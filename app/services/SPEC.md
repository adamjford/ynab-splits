# Services, OAuth, YNAB, and orchestration specification

This system owns authenticated request handling, member-owned YNAB
connections/settings, inbox orchestration, shared projections, and remote
read-back outcomes. Domain allocation and settlement value rules are in
[../domain/SPEC.md](../domain/SPEC.md). Application-wide invariants are in
[../../SPEC.md](../../SPEC.md). Operational setup, callback registration,
secrets, and safety policy remain in [README.md](../../README.md).

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
| PKCE URL, token exchange, encrypted connection persistence | `app/services/auth.server.ts`, `app/routes/auth.start.tsx`, `app/routes/auth.callback.tsx`, `app/services/crypto.server.ts` | `app/services/crypto.test.ts`, `e2e/app.spec.ts`, `e2e/fake-ynab-server.ts` |
| Member-owned settings and plan validation | `app/services/settings.server.ts`, `app/routes/settings-ynab.tsx`, `app/services/ynab-user.server.ts` | `app/services/settings.test.ts`, `e2e/app.spec.ts`, `e2e/action-feedback.spec.ts` |
| Inbox review, source snapshots, manual tasks, and recovery | `app/services/inbox-orchestration.server.ts`, `app/services/ynab-verification.server.ts` | `app/services/inbox-orchestration.test.ts`, `app/services/ynab-verification.test.ts`, `e2e/action-feedback.spec.ts` |
| Shared ledger query and ownership projection | `app/services/ledger-query.server.ts`, `app/routes/ledger.tsx`, `app/routes/ledger-entry.tsx` | `app/services/ledger-query.test.ts`, `e2e/app.spec.ts`, `e2e/navigation.spec.ts` |
| Gateway transport, settlement IDs, and exact read-back | `app/services/ynab.server.ts`, `app/services/ynab-verification.server.ts`, `app/services/inbox-orchestration.server.ts`, `app/domain/settlement-posting.ts`, `app/routes/settlement-detail.tsx` | `app/services/ynab-verification.test.ts`, `app/services/inbox-orchestration.test.ts`, `app/domain/settlement-posting.test.ts`, `e2e/fake-ynab-server.ts`, `e2e/action-feedback.spec.ts` |

The repository has no dedicated `auth.server.ts` unit test; browser coverage and
crypto tests are the current evidence for that boundary.
