# 2026 legacy importer specification

This system imports the paired 2026 transaction and split-view CSV exports into
household ledger state. The application-wide invariants in
[../../SPEC.md](../../SPEC.md) apply throughout. Operational commands and data
safety remain in [README.md](../../README.md).

## Parsing and validation

- The importer parses the transactions and split-view exports separately while
  preserving their row alignment.
- Only 2026 rows are accepted. An explicit household ID is required.
- Recorded integer minor-unit shares and transfer values are preserved. A signed
  workbook mismatch is reported as a conflict; the importer does not invent an
  adjustment.

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
