# 2026 legacy importer specification

This system imports the paired 2026 transaction and split-view CSV exports into
household ledger state. The application-wide invariants in
[../../SPEC.md](../../SPEC.md) apply throughout. Operational commands and data
safety remain in [README.md](../../README.md).

## Parsing and validation

- The importer parses the transactions and Split View exports separately while
  preserving their row alignment. It normalizes embedded whitespace for header
  matching, requires the semantic transaction headers, and requires Split View
  row 3 plus fixed columns L (`Paid/received by amount`), N (`Adam`), and O
  (`Chelsea`).
- Each accepted source row is paired with its corresponding Split View row and
  must match exactly on date, name, signed amount magnitude, and payer. Missing
  rows, malformed amounts, unsupported payer names, identity mismatches, and
  counterparty shares above the total are reported without producing a row.
- Only dates beginning with the supported 2026 period are accepted. Positive
  workbook amounts become expenses; negative amounts become income. The
  counterparty share is taken from the absolute Split View amount and the
  remainder stays with the payer or recipient. Each ordinary row receives the
  deterministic key `sheet-2026:<source-row>`.

## Historical transfers and periods

- Case-insensitive `Settle Up` rows become historical transfers rather than
  ledger entries. The signed workbook amount determines debtor and creditor,
  while the recorded transfer amount remains authoritative.
- Each transfer closes the preceding open period and reports its calculated net
  beside the recorded transfer. A mismatch is reported as an error without an
  invented adjustment. Entries after the last transfer remain in a trailing
  open period.

## Preflight and apply

- Preflight is a dry-run classification of deterministic entries, shares,
  settlements, and import items. It does not write the database.
- Apply is atomic. An immutable conflict blocks all writes; matching existing
  units are skipped; an unchanged rerun is idempotent.

## Acceptance criteria

1. Malformed, misaligned, non-2026, or missing-household input is rejected
   before import state is written.
2. A dry run reports deterministic insert, skip, and conflict units without
   changing the database.
3. An immutable conflict leaves the database unchanged.
4. Reapplying unchanged input creates no duplicate units.
5. Recorded shares and transfers remain unchanged, including signed mismatch
   conflicts.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| CSV parsing, row alignment, and 2026 validation | `app/importer/legacy2026.ts` | `app/importer/legacy2026.test.ts` |
| Atomic preflight, apply, idempotency, and immutable conflicts | `app/importer/legacy2026-apply.server.ts`, `scripts/import-2026.ts` | `app/importer/legacy2026-apply.test.ts` |
