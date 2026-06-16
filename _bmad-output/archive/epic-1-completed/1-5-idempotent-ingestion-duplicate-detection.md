---
baseline_commit: 65a031082d47da824bb48da35586bf9f922f41a3
context:
  - _bmad-output/planning-artifacts/epics.md#Story 1.5
  - _bmad-output/planning-artifacts/architecture.md#Data Architecture
  - _bmad-output/implementation-artifacts/1-4-csv-statement-upload-canonical-parsing.md
  - CLAUDE.md
---

# Story 1.5: Idempotent ingestion & duplicate detection

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want re-uploading the same statement to not create duplicates,
so that my data stays accurate.

## Acceptance Criteria

1. `POST /transactions/import` remains protected by `requireAuth` and keeps the Story 1.4 multipart contract: `file`, `bankFormat`, and `institution`. The endpoint still returns `200` with a bare summary object and still reports malformed rows without aborting valid rows.
2. Re-uploading a statement already imported for the same user and same stable csv account creates **zero duplicate transactions**. Existing transactions are matched by the existing unique key `(account_id, provider_transaction_id)`.
3. Re-uploading a statement that contains a mix of already-imported rows and genuinely new valid rows inserts only the new rows and reports the already-imported rows as duplicates.
4. Duplicate detection is explicit and accurate in the response: `imported` equals newly inserted transactions, `duplicatesSkipped` equals valid parsed rows that already existed for that account, and `malformed` is unchanged from parser output. The response remains backward-compatible with Story 1.4: `{ accountId, imported, duplicatesSkipped, malformed }`.
5. All account lookup and transaction duplicate detection/persistence stays inside `withUserContext(req.userId, ...)`. No user-scoped read or write may bypass RLS. Do not replace DB-enforced tenancy with app-only `where userId = ...` filtering.
6. Tests prove: full re-upload imports `0` and skips all valid rows; partial re-upload inserts only the new row(s); duplicate detection is scoped per account/user; malformed rows are still reported and not counted as duplicates; existing tests pass; `pnpm -r typecheck` is clean.

## Tasks / Subtasks

- [x] Task 1: Make duplicate detection explicit in the ingestion service (AC: #2, #3, #4, #5) - `apps/api/src/modules/ingestion/ingestion.service.ts`
  - [x] Keep `parseCsvStatement` as the anti-corruption boundary; do not move CSV column parsing or sign logic into the service.
  - [x] Keep the stable csv `Account` upsert keyed by `(provider="csv", providerAccountId=sha256(userId + ":" + institution))`.
  - [x] After account upsert, compare parsed canonical rows against existing `Transaction` rows for that `accountId` and their `providerTransactionId` values.
  - [x] Insert only rows whose `(accountId, providerTransactionId)` is not already present. Use `createMany` for missing rows; keep `skipDuplicates: true` as a race-safe backstop.
  - [x] Return `imported` from the actual create count and `duplicatesSkipped = validParsedRows.length - imported`. If concurrent inserts cause `createMany` to skip a row, it must count as duplicate skipped.
  - [x] Keep all queries inside `withUserContext(input.userId, async (tx) => ...)`.
- [x] Task 2: Preserve and document idempotency identity (AC: #2, #3)
  - [x] Do **not** change the Story 1.4 CSV deterministic ID format unless tests prove a bug: `sha256(date|amountCents|currency|rawDescription|occurrenceIndex)`.
  - [x] Do **not** add a new DB column or migration; `Transaction` already has `@@unique([accountId, providerTransactionId])`.
  - [x] Do not use raw CSV row number, upload timestamp, file name, or institution label in `providerTransactionId`; those would break re-upload stability.
- [x] Task 3: Strengthen route-level e2e coverage (AC: #1, #2, #3, #4, #6) - `apps/api/src/modules/ingestion/ingestion.routes.test.ts`
  - [x] Keep the existing happy path, full re-upload, non-CSV, oversized, and auth tests.
  - [x] Add a partial re-upload test: first upload rows A+B; second upload rows A+B+C; assert second response has `imported: 1`, `duplicatesSkipped: 2`, row count increases by exactly 1, and the new row is persisted with signed cents/direction/currency.
  - [x] Add a user/account scoping test: two different authenticated users uploading the same institution + same CSV must each get their own account/transactions and must not count the other user's rows as duplicates.
  - [x] Add or preserve a malformed-row assertion in a re-upload scenario: malformed rows remain in `malformed` and do not affect duplicate counts.
- [x] Task 4: Unit-test service logic where useful without duplicating route e2e (AC: #4, #5, #6)
  - [x] If a pure unit seam is practical, test the duplicate counting algorithm separately. If not, do not over-abstract just for tests; rely on the DB-gated e2e because the unique constraint and RLS are the behavior under test.
  - [x] Avoid mocking Prisma transaction semantics unless the mock proves something the route test cannot.
- [x] Task 5: Verification and story hygiene (AC: #6)
  - [x] Run `pnpm -r typecheck`.
  - [x] Run focused API tests: `pnpm --filter @clarifi/api exec vitest run src/modules/ingestion/csv-adapter.test.ts src/modules/ingestion/ingestion.routes.test.ts`.
  - [x] If DB/network access is available, run the full API suite: `pnpm --filter @clarifi/api exec vitest run`.
  - [x] Update the Dev Agent Record with test results, changed files, and any intentional tradeoffs.

## Dev Notes

### Current State From Story 1.4

- `POST /transactions/import` is already mounted at `/transactions/import` in `apps/api/src/app.ts` via `transactionsRouter`.
- `ingestion.controller.ts` validates `{ bankFormat, institution }`, reads `req.file.buffer`, and calls `importCsv`.
- `ingestion.routes.ts` already applies `requireAuth`, `multer` memory storage, 5 MB upload limit, CSV file filtering, and maps file-too-large to `413 FILE_TOO_LARGE`.
- `csv-adapter.ts` already parses TD/RBC/Scotiabank/generic CSVs into `CanonicalTransaction`, reports malformed rows, normalizes sign exactly once, captures currency, and derives stable CSV IDs with `date|amountCents|currency|rawDescription|occurrenceIndex`.
- `ingestion.service.ts` currently persists valid rows with `tx.transaction.createMany({ data, skipDuplicates: true })` and derives `duplicatesSkipped` as `data.length - result.count`. This prevents duplicates but does not explicitly identify existing rows before insert. Story 1.5 should make the duplicate detection/reporting path intentional and covered by mixed re-upload tests.

### Architecture and Guardrails

- Money stays signed integer cents (`BigInt`): outflow negative, inflow positive. Do not use floats for stored values. Reuse `directionFromCents` from `@clarifi/shared`. [Source: CLAUDE.md#Money & data model; _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- Tenancy stays DB-enforced through `withUserContext`. Every user-scoped read/write in this story must run inside the existing `withUserContext(input.userId, async (tx) => ...)` block. [Source: packages/shared/src/prisma.ts; CLAUDE.md#Money & data model]
- Idempotency is already modeled in Prisma: `Transaction @@unique([accountId, providerTransactionId])`. Do not add schema or migration work for this story. [Source: packages/shared/prisma/schema.prisma#Transaction]
- Provider anti-corruption boundary stays in `modules/ingestion/csv-adapter.ts`. The service must consume canonical rows only; it must not inspect bank-specific CSV headers or raw CSV shapes. [Source: CLAUDE.md#FDX alignment; Story 1.4 completion notes]
- Success responses remain bare camelCase JSON. Errors continue through `AppError` / central error middleware. Do not introduce response wrappers. [Source: _bmad-output/planning-artifacts/architecture.md#Data Contracts]

### Implementation Guidance

- Preferred service flow:
  1. Parse CSV: `const { transactions, errors } = parseCsvStatement(...)`.
  2. Enter `withUserContext`.
  3. Upsert/select the stable csv account.
  4. Build the DB rows from canonical transactions.
  5. Query existing transactions for `accountId` and `providerTransactionId in parsedIds`.
  6. `createMany` only the missing rows with `skipDuplicates: true`.
  7. Return `{ accountId, imported: result.count, duplicatesSkipped: data.length - result.count, malformed: errors }`.
- Be careful with duplicate providerTransactionIds within the same parsed file. The adapter's occurrence index should make valid duplicate-looking rows distinct; the service should still behave correctly if `data` contains repeated IDs.
- Keep `createMany({ skipDuplicates: true })` even after prechecking. It protects against a concurrent upload race between the duplicate lookup and insert.
- Do not rename `imported` in this story. It already means "newly inserted" in Story 1.4 tests and is part of the endpoint contract.
- Do not implement categorization, anomaly detection, Plaid/FDX ingestion, or UI work. Those are later epics.

### Previous Story Intelligence

- Story 1.4 review found and fixed a critical idempotency detail: currency must be part of the CSV content hash or RBC CAD/USD rows can collide.
- Story 1.4 tests established the DB-gated Supertest pattern: register -> login -> cookie auth -> upload CSV -> query Prisma for persisted rows -> cleanup users in `afterAll`.
- Story 1.4 e2e already verifies a full re-upload adds no duplicates. Story 1.5 should extend that to mixed re-upload and cross-user/account scoping rather than rewriting existing coverage.
- Story 1.4 implementation files are currently part of the uncommitted workspace. Build on them; do not revert or replace them.

### Project Structure Notes

- Expected UPDATE files:
  - `apps/api/src/modules/ingestion/ingestion.service.ts`
  - `apps/api/src/modules/ingestion/ingestion.routes.test.ts`
  - Possibly `apps/api/src/modules/ingestion/csv-adapter.test.ts` only if the deterministic ID behavior needs extra coverage.
- Expected unchanged files unless a test proves otherwise:
  - `packages/shared/prisma/schema.prisma` (no migration)
  - `apps/api/src/modules/ingestion/csv-adapter.ts` (parser already owns canonicalization)
  - `apps/api/src/modules/ingestion/ingestion.controller.ts`
  - `apps/api/src/modules/ingestion/ingestion.routes.ts`

### Review Findings

- [x] [Review][Patch] Institution label variants bypass idempotency for the same csv account [apps/api/src/modules/ingestion/ingestion.service.ts:40] — fixed by canonicalizing the account identity input with trimmed, whitespace-collapsed, lowercase institution text while preserving the display label.
- [x] [Review][Patch] Large valid CSVs can exceed database parameter/batch limits during duplicate lookup or insert [apps/api/src/modules/ingestion/ingestion.service.ts:77] — fixed by chunking duplicate lookup and `createMany` batches.
- [x] [Review][Patch] Missing test coverage for institution label normalization [apps/api/src/modules/ingestion/ingestion.routes.test.ts:40] — fixed with a DB-gated re-upload test using `"Test Bank"` then `" test   bank "`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] (user story and duplicate-detection AC)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] (integer cents, RLS, unique idempotency key)
- [Source: CLAUDE.md#Money & data model] (money, idempotency, RLS, anti-corruption guardrails)
- [Source: _bmad-output/implementation-artifacts/1-4-csv-statement-upload-canonical-parsing.md] (current CSV endpoint/parser/service behavior and review fixes)
- [Source: packages/shared/prisma/schema.prisma#Transaction] (`@@unique([accountId, providerTransactionId])`)
- [Source: packages/shared/src/prisma.ts] (`withUserContext` RLS transaction wrapper)
- [Source: apps/api/src/modules/ingestion/ingestion.service.ts] (current import service to update)
- [Source: apps/api/src/modules/ingestion/ingestion.routes.test.ts] (DB-gated e2e pattern)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- New Story 1.5 e2e assertions passed before the service refactor because Story 1.4's `createMany({ skipDuplicates })` already produced the correct external response. The service was still updated to explicitly pre-detect existing provider transaction IDs as required by the story, while preserving `skipDuplicates` as a race-safe backstop.
- Full regression was run with DB/network access. Prisma logs expected unique/RLS errors inside negative-path tests.
- Code review found institution identity normalization and large-batch fragility. Both were patched. The exact-same-label-for-two-physical-accounts concern is outside the current API contract because Story 1.4/1.5 define the stable CSV account by user + institution label; users can disambiguate separate accounts with distinct labels.

### Completion Notes List

- `importCsv` now explicitly queries existing transactions for the stable csv account and parsed provider transaction IDs inside `withUserContext`, inserts only missing rows, and still computes `duplicatesSkipped = validParsedRows.length - imported`.
- CSV account identity now canonicalizes the institution label for hashing (`trim` + whitespace collapse + lowercase) so casing/spacing variants reuse the same account without changing the human-readable `institutionName`.
- Duplicate lookup and insert operations are chunked to avoid oversized `IN` lists or `createMany` batches on dense CSV files.
- The CSV deterministic identity from Story 1.4 was preserved: `sha256(date|amountCents|currency|rawDescription|occurrenceIndex)`. No schema changes or migrations were added.
- Added DB-gated route e2e coverage for mixed re-upload behavior, institution label normalization, and cross-user/account duplicate scoping. Existing malformed-row, full re-upload, file validation, oversized upload, and auth coverage remains intact.
- Intentional testing tradeoff: no separate mocked service unit test was added because the behavior depends on Prisma's unique constraint, RLS transaction context, and `createMany(skipDuplicates)` semantics. The DB-gated route tests cover the real contract directly.
- Verification: `pnpm -r typecheck` passed; focused ingestion tests passed 18/18; full workspace tests passed shared 25/25 and API 46/46.

### File List

- `apps/api/src/modules/ingestion/ingestion.service.ts`
- `apps/api/src/modules/ingestion/ingestion.routes.test.ts`
- `_bmad-output/implementation-artifacts/1-5-idempotent-ingestion-duplicate-detection.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is idempotent CSV duplicate detection/reporting only; implementation intentionally not started.
- 2026-06-16: Implemented Story 1.5. Added explicit duplicate pre-detection under RLS, mixed re-upload and cross-user e2e coverage, and verified typecheck plus full regression. Status -> review.
- 2026-06-16: Code review fixes applied. Added canonical institution identity hashing, chunked duplicate lookup/createMany batches, added institution-normalization e2e coverage, and re-ran typecheck plus full regression. Status -> done.
