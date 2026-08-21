# Domain ledger and settlement specification

This system defines ledger shares, money conversion, debt, settlement previews,
and deterministic settlement targets. Application-wide privacy, ownership, and
recovery invariants are in [../../SPEC.md](../../SPEC.md). Service orchestration
and external outcomes are in [../services/SPEC.md](../services/SPEC.md).

## Ledger allocation and invariants

- A positive amount is represented as an integer minor-unit total with exactly
  one non-negative share for each distinct member.
- Equal, percentage, and exact split decisions allocate the remainder
  deterministically to the payer. Percentage inputs use basis points and exact
  shares stay within the total.
- Shares must sum to the entry total. Invalid totals, duplicate members,
  negative shares, malformed dates, and blank descriptions are rejected.
- Debt is derived from the member shares and payer. Voided entries do not
  contribute to settlement debt.

## Money and settlement preview

- YNAB milliunits are converted at the integration boundary; local domain
  calculations use integer minor units and validated currency precision.
- A settlement preview reports `owed`, `owes`, or `settled` and includes the
  contributing entries. A zero-net preview closes without a YNAB copy.
- Settlement selection and lifecycle rules require an inclusive valid date range,
  real-payment acknowledgement, unsettled entries, and at most one active link
  for each entry.

## Settlement targets and manual splits

- Simple targets use the net amount and Splitting category. Detailed targets
  require destination category mappings, preserve parent totals, and use stable
  line memos.
- Settlement import IDs are deterministic, URL-safe, and bounded for YNAB.
- Existing YNAB subtransactions produce an explicit manual target. Preparation
  preserves owner lines and replaces the counterparty line deterministically;
  verification happens through the service gateway before local status changes.

## Acceptance criteria

1. Odd minor-unit totals allocate the remainder to the payer; percentage and
   exact inputs stay within their documented bounds.
2. Ledger shares contain exactly one share for each distinct member, remain
   non-negative, and sum to the positive entry total.
3. Settlement previews ignore voided entries, zero-net periods close without
   posting, and linked entries are not selected a second time.
4. Detailed settlement targets require valid destination mappings, preserve
   totals, and produce deterministic memos/import IDs.
5. Manual split targets preserve owner lines and require explicit verification
   before a remote source is treated as updated.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Split allocation, ledger invariants, and debt | `app/domain/ledger.ts` | `app/domain/ledger.test.ts` |
| Money conversion and currency boundary | `app/domain/money.ts` | `app/domain/money.test.ts` |
| Settlement preview, selection, and date-range lifecycle | `app/domain/settlement.ts`, `app/routes/settlement-new.tsx`, `app/routes/settlement-detail.tsx` | `app/domain/settlement.test.ts`, `e2e/settlement-interactions.spec.ts` |
| Settlement targets, mappings, and import IDs | `app/domain/settlement-posting.ts` | `app/domain/settlement-posting.test.ts` |
| Manual split targets and source-line preservation | `app/domain/manual-split.ts` | `app/domain/manual-split.test.ts` |

Service-level review, posting status transitions, and external read-back are
specified in [../services/SPEC.md](../services/SPEC.md).
