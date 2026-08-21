# YNAB Splits agent context

## Project map

- `app/routes/`: React Router route modules, loaders, actions, and UI.
- `app/services/`: server-only authentication, YNAB, settlement, and external-service code.
- `app/db/`: SQLite access, schema, migrations, and transaction boundaries.
- `app/domain/`: pure ledger, split, money, and settlement rules.
- `app/importer/`: CSV parsing, normalization, and import validation.
- `e2e/`: isolated Playwright coverage using fake OAuth/YNAB services.
- `README.md`: full domain, setup, operations, and safety contract.

Do not duplicate README policy here. Read the relevant module and its tests before editing.

## Default task loop

1. Inspect relevant code, tests, callers, and configuration.
2. For multi-file work, write a concise plan before changing files.
3. Implement the smallest coherent change; avoid unrelated refactors.
4. Add or update behavior tests for the changed contract.
5. Run focused checks, then the full applicable verification command.
6. Report exact commands and results, plus any unverified assumption or blocker.

Task prompts must state: objective, affected behavior, constraints, non-goals,
acceptance criteria, and required verification. Ask rather than guess when a
product, ownership, authorization, money, or data-integrity ambiguity changes behavior.

## Verification matrix

- Domain, service, database, or importer changes: focused Vitest coverage and `pnpm typecheck`.
- Route, auth, settlement, or ownership changes: focused tests plus relevant Playwright coverage.
- UI changes: a browser test or an actual browser smoke check against the running app.
- Production bundle changes: `pnpm build`.
- Migration changes: disposable SQLite database and `pnpm db:migrate`.
- Mergeable changes: run `pnpm verify` from the repository root.

Tests must cover applicable success, failure, boundary, authorization/ownership,
idempotency, and stale/conflict states. Never weaken assertions, add broad skips,
use fake external credentials outside the existing test harness, or test against
the operational database.

## OMP operating pattern

- Use plan mode for multi-file or ambiguous work.
- Use a fresh `reviewer` for correctness/regression review and a fresh
  `security-reviewer` for auth, secrets, data, or remote-write changes.
- Use `scout` only for bounded read-only exploration.
- Do not parallelize overlapping edits in this small repository.
- Keep writer and reviewer sessions separate; the reviewer receives the diff,
  acceptance criteria, and test evidence and reports concrete gaps.
- Agents may read/edit this repository and run non-destructive local checks when
  the task authorizes the change.
- External writes, destructive commands, deployments, merges, pushes, real YNAB
  mutations, secret access, and operational database access require explicit approval.

## GPT-5.6 model use

Use the explicit model-role mappings in the active OMP profile. Use medium effort
for normal implementation, high effort for difficult debugging or security review,
and low effort only for bounded scouting or mechanical work. Prefer concise
decisions and evidence; do not request or expose hidden chain-of-thought.

## Completion standard

A change is complete only when its acceptance criteria are met, applicable checks
pass, safety boundaries remain intact, and the result names exact verification.
A failed check stays visible: fix the cause or report the exact blocker.

## Triple-helix adoption

This repository uses triple-helix development: every supported behavior is kept
reproducible across a concise spec, executable tests, and implementation.

Canonical contract locations:

- `README.md` remains the application setup, operations, and safety contract.
  Link to it rather than copying its operational policy.
- Root `SPEC.md` records application-wide behavioral invariants and indexes the
  system specs.
- `app/domain/SPEC.md` records domain ledger, money, split, and settlement
  rules.
- `app/services/SPEC.md` records request ownership, OAuth, YNAB settings,
  inbox orchestration, shared projections, and remote verification.
- `app/importer/SPEC.md` records the 2026 legacy importer contract.

Every canonical spec is named exactly `SPEC.md` and lives beside the
implementation boundary that owns the behavior it documents. Do not create a
detached `docs/spec` tree or alternate spec filenames. If a behavior spans
boundaries, place the spec at the nearest meaningful owner or split it across
owners, then map all cross-boundary paths.

The hierarchy is `application → system → section`, with no deeper nesting.
Each spec maps its sections to exact implementation paths and focused test
paths. Keep the map current when files move or behavior changes.

When a behavior has two helixes, derive the missing one from the other two. When
fewer than two exist, generate in this order: spec, focused tests, then
implementation. State observable success, failure, boundary, ownership,
idempotency, stale/conflict, and data-integrity cases before changing code.

Verify at the focused boundary first (Vitest, route/service coverage, or the
fake-service Playwright path), then run the applicable broader check from the
verification matrix. Documentation-only changes do not require project-wide
validation. Preserve household ownership, member-private YNAB identifiers,
integer minor-unit accounting, deterministic recovery, fake external services,
and the existing prohibition on operational databases, real credentials, and
real remote writes.
