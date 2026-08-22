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
  Conversion rejects unsafe values, unsupported decimal precision, and
  milliunit amounts that cannot represent an exact minor unit. Linked plans
  must have matching ISO currency and decimal precision.
- An expense makes the nonpayer owe their share; an income or refund makes the
  recipient owe the other member's share. Debt signs are stable across mixed
  expense and income entries.
- A settlement preview reports `owed`, `owes`, or `settled` and includes the
  contributing entries. Voided entries are ignored. A zero-net preview closes
  without a YNAB copy.
- Settlement selection and lifecycle rules require an inclusive valid date
  range, real-payment acknowledgement, unsettled entries, and at most one
  active link for each entry.

## Settlement targets and manual splits

- Simple targets use the signed net amount and Splitting category. Detailed
  targets add mapped destination-category lines for positive debt and one
  aggregate Splitting line for the opposite direction, preserve the parent
  total, use stable line memos, and omit zero-value lines.
- Missing or blank detailed destination mappings and blank Splitting categories
  are rejected. An uncategorized source uses Splitting rather than inventing a
  destination category.
- Settlement import IDs are deterministic, URL-safe, and bounded for YNAB.
- Existing YNAB subtransactions produce an explicit manual target. Preparation
  preserves owner lines, their payees and memos, and replaces the counterparty
  line deterministically. The target requires a nonempty integer allocation
  totaling the owner's signed share.
- Manual verification compares the parent identity when present, parent
  amount, account, date, payee, approval state, and an order-independent
  multiset of split lines including category, amount, payee, and memo. It
  returns concrete differences rather than treating a partial match as
  success.

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
