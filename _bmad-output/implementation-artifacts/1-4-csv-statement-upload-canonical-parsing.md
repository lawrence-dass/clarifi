---
baseline_commit: 65a0310
context:
  - _bmad-output/planning-artifacts/epics.md#Story 1.4
  - _bmad-output/planning-artifacts/architecture.md#Data Architecture
  - CLAUDE.md
---

# Story 1.4: CSV statement upload & canonical parsing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to upload a bank CSV and have it parsed,
so that my transactions appear in Clarifi.

## Acceptance Criteria

1. `POST /transactions/import` (behind `requireAuth`) accepts a **multipart CSV upload** (`file` field) plus a `bankFormat` (`td` | `rbc` | `scotiabank` | `generic`) and an `institution` label. Rows are parsed into the **canonical transaction model via the CSV adapter** (the anti-corruption layer — the rest of the app never sees raw CSV shapes).
2. Amounts are stored as **signed integer cents (BigInt), outflow negative / inflow positive**, converted via the existing `dollarsToCents`. The **provider sign convention is normalized exactly once, in the adapter** (debit/credit columns → signed; or a single signed column → as-is per the bank profile). `direction` is derived from the sign via the existing `directionFromCents`. `currency` is captured per row (CAD default; RBC's `USD$` column → USD).
3. **Malformed rows are reported, not fatal:** a row that fails to parse (bad date, non-numeric amount, missing required field) is collected into an errors list with its row number + reason; valid rows still import. The response is `200` with `{ accountId, imported, duplicatesSkipped, malformed: [{ row, reason }] }`.
4. All persistence runs through **`withUserContext(req.userId, …)`** (first request-path use of RLS). The import upserts a **csv `Account`** keyed on `(provider="csv", providerAccountId=<stable per-user+institution hash>)` so re-importing the same institution reuses one account, then inserts transactions with a **deterministic `providerTransactionId`** (content hash) so Story 1.5 can dedupe. Insert with `createMany({ skipDuplicates: true })` so a re-upload neither errors nor duplicates (full upsert/reporting is Story 1.5).
5. A protected, validated, tested endpoint: Zod-validates the form fields; rejects a missing/oversized/non-CSV file (`400`/`413`). Unit tests cover the adapter (each bank profile, sign normalization, malformed-row collection, deterministic id); a DB-gated e2e test uploads a CSV and asserts persisted signed-cents transactions + a malformed row reported + re-upload adds no duplicates. Existing tests pass; `pnpm -r typecheck` clean.

## Tasks / Subtasks

- [x] Task 1: Canonical model in `@clarifi/shared` (AC: #1, #2) — `packages/shared/src/canonical.ts`
  - [x] `CanonicalTransaction` (Zod + inferred type): `providerTransactionId: string`, `date: Date`, `amountCents: bigint` (signed), `currency` (3-char), `rawDescription: string`, `merchantName?: string`. Provider-agnostic — Plaid/FDX will map to this same shape later. Export from `index.ts`.
- [x] Task 2: Bank profiles + CSV adapter (AC: #1, #2, #3) — `apps/api/src/modules/ingestion/`
  - [x] `bank-profiles.ts`: a profile per `bankFormat` declaring header detection + column mapping: `date` column + date format, `description` column(s), and amount handling — either a single **signed** amount column or a **debit/credit pair** — plus the sign rule and currency column (RBC: `CAD$`/`USD$`). Profiles: TD (Date/Description/Debit/Credit), RBC (Transaction Date/Description 1+2/CAD$/USD$), Scotiabank (Date/Description/Amount signed), and `generic` (Date/Description/Amount signed).
  - [x] `csv-adapter.ts`: `parseCsvStatement(csv: string, profile): { transactions: CanonicalTransaction[]; errors: { row: number; reason: string }[] }`. Use **`papaparse`** (`header: true`, `skipEmptyLines: true`). For each row: parse date (per profile format → `Date`; reject invalid), compute **signed cents via `dollarsToCents`** (debit → negative, credit → positive; or single signed column normalized so outflow < 0 — **normalize here, once**), capture currency, build `rawDescription`. Derive `providerTransactionId = sha256("date|amountCents|currency|rawDescription|occurrenceIndex")` (occurrenceIndex disambiguates identical rows in one file → deterministic across re-uploads, and currency prevents CAD/USD collisions). **Never throw on a bad row** — push to `errors` and continue.
- [x] Task 3: Ingestion service — account + persist (AC: #4) — `apps/api/src/modules/ingestion/ingestion.service.ts`
  - [x] `importCsv({ userId, bankFormat, institution, csv })`: select the profile; `parseCsvStatement`; inside **`withUserContext(userId, async (tx) => …)`**: upsert the csv `Account` on `(provider="csv", providerAccountId = sha256(userId + ":" + institution))` (`balanceCents: 0n`, `accountType: "other"`, `currency: "CAD"`, `institutionName: institution`); map canonical rows → `transactions` rows (`userId`, `accountId`, `provider: "csv"`, `direction: directionFromCents(amountCents)`, `status: "posted"`); `tx.transaction.createMany({ data, skipDuplicates: true })`. Return `{ accountId, imported: result.count, duplicatesSkipped: data.length - result.count, malformed: errors }`.
  - [x] Reuse `directionFromCents` / `dollarsToCents` from `@clarifi/shared` — do NOT recompute sign logic.
- [x] Task 4: Upload endpoint (AC: #1, #5) — `apps/api/src/modules/ingestion/ingestion.{controller,routes}.ts`
  - [x] `multer` memory storage, `limits: { fileSize: 5 * 1024 * 1024 }`, single `file` field; reject non-CSV mimetype/extension. Zod-validate `{ bankFormat, institution }` from `req.body`. Controller: read `req.file.buffer.toString("utf8")`, call `importCsv`, respond `200` with the summary. Mount `transactionsRouter` (or `ingestionRouter`) at `/transactions` in `app.ts`, gated by `requireAuth`.
  - [x] Map multer errors (file too large → `413`, missing file → `400 NO_FILE`) through the existing error contract; add an `unprocessable`/`badRequest` as needed (reuse `app-error.ts`).
- [x] Task 5: Deps + tests + verify (AC: #5)
  - [x] Add deps (gated): `multer` + `@types/multer`, `papaparse` + `@types/papaparse`.
  - [x] `csv-adapter.test.ts` (no DB): each profile parses a sample CSV; debit→negative / credit→positive / single-signed normalized outflow<0; CAD vs USD captured; a malformed row (bad date, non-numeric amount) is collected not thrown; `providerTransactionId` is deterministic across two parses and disambiguates duplicate rows.
  - [x] `ingestion.routes.test.ts` (supertest, DB-gated, authenticated via register→login cookie): upload a small CSV with one malformed row → `200`, `imported` correct, `malformed` lists the bad row; query the DB and assert a known row stored signed cents + correct `direction`/`currency`; re-upload the same file → `duplicatesSkipped` == imported, no new rows. Reject a `.txt`/oversized file.
  - [x] `pnpm -r typecheck` + `pnpm -r test` green.

### Review Findings

- [x] [Review][Decision] Include currency in CSV providerTransactionId hash — resolved by updating the deterministic CSV id to `date|amountCents|currency|rawDescription|occurrenceIndex` and adding CAD/USD collision coverage.
- [x] [Review][Patch] Missing descriptions are imported as valid transactions [apps/api/src/modules/ingestion/csv-adapter.ts:35]
- [x] [Review][Patch] PapaParse structural errors are ignored [apps/api/src/modules/ingestion/csv-adapter.ts:18]
- [x] [Review][Patch] Money parser accepts non-money numeric forms [apps/api/src/modules/ingestion/csv-adapter.ts:136]
- [x] [Review][Patch] Bank profiles do not implement declared header detection [apps/api/src/modules/ingestion/bank-profiles.ts:23]
- [x] [Review][Patch] Oversized upload 413 behavior is untested [apps/api/src/modules/ingestion/ingestion.routes.test.ts:84]

## Dev Notes

### Guardrails this story is the FIRST to exercise (get them right)
- **Money = signed integer cents, normalized once at ingestion** (CLAUDE.md). The CSV adapter is the *single* place the bank's sign convention is interpreted; everything downstream sees canonical signed cents (outflow < 0). Use `dollarsToCents` (parses dollars → cents) and `directionFromCents` (sign → `debit`/`credit`) — both already in `@clarifi/shared/money`. Do not hand-roll cents math or sign logic.
- **Anti-corruption layer** (CLAUDE.md / architecture.md): CSV is one interchangeable *adapter* into the provider-agnostic `CanonicalTransaction`. Keep parsing/column-mapping inside `modules/ingestion`; the service and DB never reference CSV column names. This is the same pattern Plaid (Epic 4) and FDX (Epic 7) will reuse — design the canonical type to fit all three (it already maps to Plaid's fields).
- **Tenancy via `withUserContext`** — this is the **first request-path consumer of RLS**. The user is authenticated (`requireAuth` set `req.userId`), so unlike registration/login this MUST run inside `withUserContext(req.userId, tx => …)` (sets `SET LOCAL ROLE clarifi_app` + the `app.current_user_id` GUC; the account/transaction RLS policies then scope writes). The `WITH CHECK` on `accounts`/`transactions` enforces `user_id = context`, so set `userId` on every row. Establish this pattern cleanly — Epics 2–8 copy it.
- **Idempotency key** = `(account_id, provider_transaction_id)` unique. CSV has no native id, so derive a deterministic one (content hash + occurrence index). Story 1.5 turns `createMany skipDuplicates` into a true upsert with reporting — but get the deterministic id right NOW or 1.5 can't dedupe.

### Sign normalization specifics (the easy-to-get-wrong part)
- **Debit/credit columns (TD):** a value in `Debit` is an outflow → `amountCents` negative; a value in `Credit` is an inflow → positive. Exactly one of the two is populated per row.
- **Single signed column (RBC `CAD$`, Scotia/generic `Amount`):** banks already sign these from the customer's perspective (debits negative). Pass the parsed value straight to `dollarsToCents` — but **verify per profile**; if a bank uses positive-for-withdrawal, the profile must flip it. The profile declares the convention; the adapter applies it once.
- Parse amount strings defensively: strip `$`, thousands separators (`,`), surrounding spaces, and handle parentheses-negatives `($12.34)` if present. A value that isn't a finite number → malformed row.

### Reuse — do NOT recreate
- **`dollarsToCents`, `directionFromCents`, `sumCents`, `formatCents`** already exist ([packages/shared/src/money.ts]) — import them.
- **`requireAuth`** ([apps/api/src/middleware/auth.ts]) gates the route and sets `req.userId`.
- **`withUserContext`** ([packages/shared/src/prisma.ts]) — the RLS wrapper; `tx` inside is a `Prisma.TransactionClient`.
- **Error contract** — `AppError` + `errorMiddleware` ([apps/api/src/lib/app-error.ts], [.../middleware/error.ts]); add helpers only if a needed status is missing.
- **Shared Zod pattern** ([packages/shared/src/auth.ts]) for the `{ bankFormat, institution }` body schema.
- **Transaction/Account models** ([packages/shared/prisma/schema.prisma]) — complete; **no schema change / no migration** this story. `Account.balanceCents` is required → set `0n` for CSV (we don't trust a CSV running-balance in v1).

### Library choices
- **`papaparse`** — robust CSV (quoted fields, embedded commas/newlines, header mode). Parse the in-memory buffer string; don't write temp files.
- **`multer`** — standard Express multipart; memory storage (no disk), 5 MB cap, single file. Test with supertest `.attach("file", Buffer.from(csv), "statement.csv")` and `.field("bankFormat", …)`.
- **Dates:** parse per-profile format manually (e.g. `YYYY-MM-DD`, `MM/DD/YYYY`) into a UTC `Date`; reject anything that doesn't match → malformed row. Avoid a date lib for the 2–3 known formats; revisit if formats expand.

### API contract (architecture.md)
- Success returns the resource/summary directly (no wrapper), camelCase, `200`. Errors via the central middleware: `400`/`413`/`422` with `{ error: { code, message, details? } }`. No PII in logs (never log raw descriptions / amounts).

### Testing standards (mirror prior stories)
- Vitest, co-located `*.test.ts`. Adapter units are **pure (no DB)** and always run. The e2e is DB-gated (`describe.skipIf(!hasDb)`), authenticated via the register→login cookie helper from `auth.routes.test.ts` (extract/share it). `.npmrc` `workspace-concurrency=1` keeps the shared-DB suites serial; clean up created users (cascade removes accounts + transactions) in `afterAll`.

### Scope fence
- No web upload UI (later). No categorization (Epic 2). No true idempotent upsert + duplicate *reporting* beyond `skipDuplicates` (Story 1.5). No Plaid/FDX adapters (Epics 4/7) — but the `CanonicalTransaction` type must be shaped to fit them.

### Project Structure Notes
New: `packages/shared/src/canonical.ts` (+ `index.ts` export); `apps/api/src/modules/ingestion/{bank-profiles,csv-adapter,csv-adapter.test,ingestion.service,ingestion.controller,ingestion.routes,ingestion.routes.test}.ts`; mount in `apps/api/src/app.ts`. Possibly a tiny `apps/api/src/lib/` date/amount helper if shared across profiles.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] (+ Story 1.5 for the idempotency boundary)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] (signed integer cents; normalize Plaid/provider sign once at ingestion; idempotency constraint)
- [Source: CLAUDE.md] (money guardrails; FDX anti-corruption layer; tenancy via withUserContext; import types from @clarifi/shared)
- [Source: packages/shared/src/money.ts] (dollarsToCents, directionFromCents — reuse)
- [Source: packages/shared/prisma/schema.prisma] (Transaction/Account; @@unique([accountId, providerTransactionId]))
- [Source: apps/api/src/middleware/auth.ts] (requireAuth → req.userId)
- [Source: packages/shared/src/prisma.ts] (withUserContext RLS wrapper)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- `prisma migrate diff --from-migrations` needs a shadow DB (Supabase has none) — not relevant here (no schema change), but the same `--from-config-datasource` pattern from Story 1.3 stays the way to author future migrations.
- multer `fileFilter` callback is overloaded (`cb(error)` to reject OR `cb(null, accept)` to accept) — a single `cb(maybeError, bool)` call doesn't typecheck; branched it.
- `noUncheckedIndexedAccess` flags `array[i].prop` in tests — used `!` after length assertions.

### Completion Notes List

- All 5 ACs satisfied. `POST /transactions/import` (requireAuth + multer memory upload, 5 MB cap, CSV-only) parses via the CSV adapter into the canonical model, persists under `withUserContext(req.userId)` (RLS), and returns `{ accountId, imported, duplicatesSkipped, malformed }`.
- **Anti-corruption layer:** `CanonicalTransaction` lives in `@clarifi/shared`; the CSV column-mapping lives entirely in `modules/ingestion` (bank-profiles + adapter). Plaid/FDX will map to the same canonical type.
- **Sign normalized once:** the adapter is the only place the bank convention is interpreted — debit→negative / credit→positive, or a single signed column; cents via the existing `dollarsToCents`; `direction` via `directionFromCents`. Verified by adapter units (incl. a bank that writes debits positive).
- **First request-path RLS use:** the service runs entirely inside `withUserContext`; account + transaction writes satisfy the `WITH CHECK (user_id = GUC)` policies. This is the pattern Epics 2–8 copy.
- **Idempotency seed:** deterministic `providerTransactionId = sha256(date|cents|currency|desc|occurrenceIndex)` + `createMany({ skipDuplicates })` → re-upload is a no-op (Story 1.5 makes it a reporting upsert). Proven by the re-upload e2e (`duplicatesSkipped == imported`, row count stable).
- **Malformed rows reported, not fatal:** bad date / non-numeric amount collected with row number; valid rows still import. Verified at both adapter and HTTP layers.
- Added deps: `papaparse`, `multer` (+ `@types/*`). No schema change / no migration. Review fixes added currency-safe idempotency, required-description rejection, PapaParse structural error reporting, strict money parsing, header detection, and oversized upload e2e coverage. Full relevant suites green: shared 25/25 + api 43/43; typecheck clean.

### File List

- `packages/shared/src/canonical.ts` (new — `CanonicalTransaction` + `RowError`)
- `packages/shared/src/index.ts` (modified — export `./canonical.js`)
- `apps/api/src/modules/ingestion/bank-profiles.ts` (new — TD/RBC/Scotiabank/generic profiles)
- `apps/api/src/modules/ingestion/csv-adapter.ts` (new — `parseCsvStatement` anti-corruption layer)
- `apps/api/src/modules/ingestion/csv-adapter.test.ts` (new — adapter units)
- `apps/api/src/modules/ingestion/ingestion.service.ts` (new — account upsert + persist via withUserContext)
- `apps/api/src/modules/ingestion/ingestion.controller.ts` (new — import handler)
- `apps/api/src/modules/ingestion/ingestion.routes.ts` (new — multer + route)
- `apps/api/src/modules/ingestion/ingestion.routes.test.ts` (new — DB-gated e2e)
- `apps/api/src/app.ts` (modified — mount `/transactions`)
- `apps/api/package.json` (modified — papaparse, multer, @types/*)
- `pnpm-lock.yaml` (modified — new deps)

## Change Log

- 2026-06-15: Story created (ready-for-dev). Establishes the CSV adapter (anti-corruption layer) → canonical model, signed-cents sign-normalization once at ingestion, first request-path use of withUserContext (RLS), and a deterministic providerTransactionId to enable Story 1.5 idempotency.
- 2026-06-15: Implemented Story 1.4 — canonical model, CSV adapter (4 bank profiles, sign normalization, malformed-row collection, deterministic id), ingestion service (csv Account upsert + createMany under RLS), multipart import endpoint. Added papaparse + multer. Status → review.
- 2026-06-15: Code review fixes applied — currency included in the deterministic CSV id, required descriptions enforced, PapaParse structural errors reported, strict money syntax enforced, bank metadata header detection added, oversized upload test added. Shared 25/25 + API 43/43 tests green; typecheck clean. Status → done.
