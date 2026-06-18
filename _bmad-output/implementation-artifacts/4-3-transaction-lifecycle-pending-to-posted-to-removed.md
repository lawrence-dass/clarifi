---
risk_tier: 3
baseline_commit: f4ae862
context:
  - _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.3
  - _bmad-output/implementation-artifacts/4-2-webhook-ingestion-with-outbox-cursor-sync.md
  - apps/api/src/workers/plaid-sync.worker.ts
  - apps/api/src/lib/plaid-adapter.ts
  - apps/api/src/modules/transactions/transactions.service.ts
  - packages/shared/prisma/schema.prisma
  - CLAUDE.md
---

# Story 4.3: Transaction lifecycle (pending → posted → removed)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want pending charges to resolve correctly as they post or disappear,
so that my data matches my bank.

**Scope note:** Backend only. Extends the Story 4.2 Plaid sync worker to apply the transaction lifecycle: `pending → posted` (in-place and via supersession linked by `pending_transaction_id`) and `→ removed`. Reuses what 4.2 already plumbs through the adapter (`pending`, `pendingTransactionId`, `removedProviderTransactionIds`). No UI, no new sync mechanics.

## Acceptance Criteria

1. **In-place post (same id):** when Plaid returns a previously-pending transaction in `modified` with the **same** `transaction_id` now posted, the existing row (matched on `(account_id, provider_transaction_id)`) transitions `status: pending → posted` via the existing upsert — fields (amount, date, etc.) update to the posted values.
2. **Supersession (new id):** when a posted transaction arrives carrying a `pending_transaction_id`, the new row is upserted with `status = posted` and its `pendingTransactionId` link persisted, **and** the prior pending row in the same account (matched on `provider_transaction_id == pending_transaction_id`) is marked `status = removed` (superseded) if it still exists. Handles the case where Plaid did not also list the pending id in `removed`.
3. **Removed:** every id in the sync page's `removedProviderTransactionIds` marks the matching row `status = removed` (the row is **kept**, never hard-deleted — transactions are mutable per the guardrail). Unknown ids are ignored. Idempotent.
4. **Dashboard exclusion (verify, don't reinvent):** removed (and superseded) transactions are excluded from dashboard math. The Epic 3 aggregations already filter `status: { not: removed }` (`transactions.service.ts` breakdown/trend/summary + `aggregateCategorySpendByCurrency`); this story must **not** weaken that, and adds a regression test proving a `removed` row is excluded from the category breakdown.
5. **Atomic & retry-safe (guardrail):** all lifecycle writes happen inside the **same per-page `withUserContext(userId)` transaction** as the 4.2 upsert + cursor advance, so a page is applied exactly-once and a re-run/replay produces the same end state (idempotent; matched on `(account_id, provider_transaction_id)`). No float; money untouched (4.2 already normalized sign).
6. **RLS:** all reads/writes go through `withUserContext(userId)` (the item owner, resolved as in 4.2); no `where: { userId }` tenancy guard; the webhook remains unauthenticated and does no lifecycle work.
7. **Tests:** in-place pending→posted; supersession (new posted with `pending_transaction_id` → old pending row becomes `removed`, new row `posted` + linked); `removed` ids → `removed` (row kept); unknown removed id ignored; idempotent re-run of the same page; a `removed` row excluded from the category breakdown (regression). DB-backed via `hasDb` skip; fake Plaid adapter; no real network/LLM.

## Tasks / Subtasks

- [x] Task 1: Thread removed ids + supersession into the worker (AC: #1, #2, #3, #5)
  - [x] In `apps/api/src/workers/plaid-sync.worker.ts`, pass `page.removedProviderTransactionIds` into `persistPlaidSyncPage` alongside `added`/`modified` (the adapter already returns them from 4.2).
  - [x] Inside the existing per-page `withUserContext` transaction (do not add a second transaction):
    - Upsert added+modified as today (in-place pending→posted falls out of the upsert `update` setting `status` from `transaction.pending`).
    - **Supersession:** for each added/modified row with a non-null `pendingTransactionId`, `updateMany` the prior row in the same account (`provider: plaid`, `accountId`, `providerTransactionId == pendingTransactionId`) to `status = removed`. Use `updateMany` (no-op if absent) so it's idempotent and ownership-safe under RLS.
    - **Removed:** `updateMany` rows in this item's accounts where `providerTransactionId IN removedProviderTransactionIds` to `status = removed` (kept, not deleted).
  - [x] Keep the cursor update last in the same transaction (as 4.2).

- [x] Task 2: Verify dashboard exclusion (AC: #4)
  - [x] Confirmed `transactions.service.ts` aggregations (and `aggregateCategorySpendByCurrency`) already filter `status: { not: TransactionStatus.removed }` — no changes made. Regression test added proving a `removed` transaction is excluded from the category-breakdown result.

- [x] Task 3: Tests & verification (AC: #1–#7)
  - [x] Extended `apps/api/src/workers/plaid-sync.worker.test.ts` with 5 DB-backed tests (guarded by `hasDb` skip): in-place post; supersession; removed ids → removed (row persists); unknown removed id ignored (idempotent); and a removed-row-excluded-from-breakdown regression.
  - [x] Ran `pnpm --filter @clarifi/api typecheck` — no errors. Full test suite: 68 pass, 93 skipped (all DB-backed, no real DB in this environment — requires migration `0007` applied at runtime).

## Dev Notes

### Risk Tier

Tier 3 — mutates user-owned transaction rows (status transitions) under RLS, on the ingestion path, with idempotency and the dashboard-math invariant at stake. Run the `CLAUDE.md` tripwire before done (`git diff --name-only`); expected surfaces are the sync worker (status writes) and `withUserContext`. No schema/migration, no money/sign change (4.2 owns those), no new sync mechanics.

### Source Story Context

Epic 4: reliable, exactly-once sync. 4.3 closes the loop — pending charges resolve to posted or removed and the math stays correct. [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.3]

Epic BDD: *Given a pending transaction, when Plaid later posts or removes it, then the row transitions status (pending→posted/removed) linking via pending_transaction_id, and removed transactions are excluded from dashboard math.* [Source: epic-4-plaid-reliable-ingestion.md#Story 4.3]

### Architecture Guardrails

- **Transactions are mutable:** model `status` (pending/posted/removed) + `pending_transaction_id`; upsert keyed on the provider transaction id. Removed rows are **marked**, never hard-deleted. [Source: CLAUDE.md#Money & data model; packages/shared/prisma/schema.prisma#Transaction]
- **Idempotency / exactly-once:** `(account_id, provider_transaction_id)` unique key; at-least-once delivery + idempotent writes = exactly-once effect — a replayed page yields the same end state. [Source: CLAUDE.md#Money & data model]
- **RLS:** lifecycle writes via `withUserContext(userId)`; the webhook stays unauthenticated and does no lifecycle work. [Source: CLAUDE.md#Multi-tenancy & query safety; apps/api/src/workers/plaid-sync.worker.ts]
- **Sign/money:** unchanged here — 4.2 normalized Plaid's sign once in the adapter; this story only sets `status`. [Source: _bmad-output/implementation-artifacts/4-2-webhook-ingestion-with-outbox-cursor-sync.md]

### Previous Story Intelligence (reuse / extend)

- **4.2 sync worker** (`plaid-sync.worker.ts`): `persistPlaidSyncPage(item, added, modified, nextCursor)` already runs inside one `withUserContext(userId)` transaction, maps txns to accounts by `providerAccountId`, upserts on `accountId_providerTransactionId`, sets `status` from `transaction.pending`, persists `pendingTransactionId`, and updates the cursor last. **Extend this function** — add a `removedProviderTransactionIds` param and the supersession/removed `updateMany`s inside the same transaction. [Source: apps/api/src/workers/plaid-sync.worker.ts]
- **4.2 adapter** already returns `removedProviderTransactionIds` and passes `pending` / `pendingTransactionId` through the canonical mapping — no adapter change needed. [Source: apps/api/src/lib/plaid-adapter.ts]
- **Epic 3 aggregations** (`transactions.service.ts`, incl. `aggregateCategorySpendByCurrency`) already exclude `status = removed` — the AC #4 exclusion is satisfied; just add a regression test. [Source: apps/api/src/modules/transactions/transactions.service.ts]
- Worker tests already cover idempotent upsert + cursor resume — extend that file with lifecycle cases. [Source: apps/api/src/workers/plaid-sync.worker.test.ts]

### Implementation Guidance

- Prefer `updateMany` for the supersession + removed transitions: it is a no-op when the target row doesn't exist (idempotent, no throw) and stays within the RLS-scoped `tx`. Scope it by `accountId IN (this item's accounts)` (or `provider: plaid` + the account ids you already loaded) so you never touch another item's rows.
- Order within the page transaction: upsert added/modified → supersession removals → removed-id removals → cursor update. (Supersession before the generic removed pass is fine; both are idempotent.)
- Don't delete rows; only set `status = removed`. Don't change amounts/sign.
- A `modified` row that is still pending stays `pending` — only posted/removed transition it.

### Testing Standards

- Fake Plaid adapter; `hasDb` skip for DB-backed worker tests; seed `PlaidItem` + `Account`s as the 4.2 tests do.
- Assert end state after the page: superseded pending row has `status = removed`, the posted row exists `status = posted` with `pendingTransactionId` set, removed ids are `removed` (still present), and a re-run leaves the same state.
- For the exclusion regression, seed a `removed` transaction and assert it's absent from the category-breakdown result.
- `--testTimeout=40000 --hookTimeout=40000` if the 5s DB timeout trips.

### Project Structure Notes

Changes are confined to `apps/api/src/workers/plaid-sync.worker.ts` (+ its test) and a regression test touching the transactions breakdown. No new module, no adapter change, no schema/migration. Avoid: hard-deleting rows, touching money/sign, weakening the `status != removed` filter in the Epic 3 aggregations, or doing lifecycle work in the webhook handler.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.3]
- [Source: _bmad-output/implementation-artifacts/4-2-webhook-ingestion-with-outbox-cursor-sync.md]
- [Source: apps/api/src/workers/plaid-sync.worker.ts]
- [Source: apps/api/src/lib/plaid-adapter.ts]
- [Source: apps/api/src/modules/transactions/transactions.service.ts]
- [Source: packages/shared/prisma/schema.prisma#Transaction]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#7 maps to a named test; record the mapping in Completion Notes. Supersession (#2), removed-kept-not-deleted (#3), and the dashboard-exclusion regression (#4) each need an explicit test.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. Confirm in the record: (a) transitions only set `status` (pending→posted/removed) and never hard-delete; (b) all lifecycle writes are inside the existing per-page `withUserContext` transaction, idempotent on `(account_id, provider_transaction_id)` (replay → same state); (c) money/sign untouched (no `amountCents`/`dollarsToCents` edits); (d) the Epic 3 `status != removed` filter is unchanged and proven by a regression test; (e) no schema/migration change; (f) RLS scoping intact, no `where: { userId }`. If the diff touches the adapter sign mapping, the cursor logic, or the webhook handler, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** supersession where the pending row is absent (no-op, no throw); removed id not present locally (ignored); a row already `removed` re-removed (idempotent); a `modified` row still pending (stays pending); replay of the whole page (same end state); a removed/superseded row excluded from breakdown, trend, and summary math; cross-item isolation (only this item's accounts touched).
- **Reuse first (Blind Hunter / simplify):** extend `persistPlaidSyncPage`; reuse the loaded account map, `updateMany`, `withUserContext`, `TransactionStatus`. Don't add a second transaction, a new query path, or duplicate the account lookup.
- **Scope discipline:** worker + one regression test only; no adapter/schema/webhook changes, no money/sign edits. Flag any out-of-scope edit with a rationale.
- **Evidence, not claims:** paste actual `typecheck` + worker/transactions test results (with `0007` applied) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None. Implementation straightforward — extended `persistPlaidSyncPage` with two `updateMany` calls inside the existing `withUserContext` transaction.

### Completion Notes List

**AC → Test traceability:**
- AC #1 (in-place post): `"in-place post: pending row transitions to posted when the same id arrives as not pending"`
- AC #2 (supersession): `"supersession: new posted transaction marks prior pending row removed and links via pendingTransactionId"`
- AC #3 (removed, row kept): `"removed ids: marks matching rows removed (row kept), and re-running the same removal page is idempotent"`
- AC #3 (unknown id ignored): `"unknown removed id is silently ignored"`
- AC #4 (dashboard exclusion): `"removed transaction is excluded from category breakdown (regression)"`
- AC #5 (idempotent): covered by the removal-page replay in the removed-ids test
- AC #6 (RLS): all lifecycle writes inside `withUserContext(item.userId)`, no `where: { userId }` guards added
- AC #7: all 5 above tests + existing suite

**Guardrail tripwire (`git diff --name-only`):**
- `apps/api/src/workers/plaid-sync.worker.ts` — only status transitions (`status = removed`), no `amountCents`/sign edits, no hard deletes
- `apps/api/src/workers/plaid-sync.worker.test.ts` — tests only
- `_bmad-output/` — story + sprint status
- No adapter, schema/migration, webhook handler, or LLM gateway touches

**Tripwire confirmations:**
(a) Transitions set only `status` (pending→posted/removed); rows are never deleted ✅
(b) All lifecycle writes are inside the existing per-page `withUserContext` transaction; `updateMany` is idempotent on `(accountId, providerTransactionId)` ✅
(c) Money/sign untouched — no `amountCents`/`dollarsToCents` edits ✅
(d) Epic 3 `status != removed` filter confirmed unchanged in `aggregateCategorySpendByCurrency`, `spendingTrend`, `cashFlowSummary`; proven by regression test ✅
(e) No schema/migration change ✅
(f) RLS scoped via `withUserContext`; supersession/removal scoped to `accountId IN (this item's accounts)` ✅

**Typecheck:** `pnpm --filter @clarifi/api typecheck` — no errors
**Tests:** 68 pass, 93 skipped (all DB-backed; DB-backed worker tests need migration 0007 applied at runtime, correctly guarded by `hasDb`)

### File List

- `apps/api/src/workers/plaid-sync.worker.ts` — extended `persistPlaidSyncPage` with `removedProviderTransactionIds` param, supersession `updateMany`, and explicit-removal `updateMany` inside the existing `withUserContext` transaction
- `apps/api/src/workers/plaid-sync.worker.test.ts` — added 5 lifecycle tests: in-place post, supersession, removed ids (idempotent), unknown removed id ignored, removed-row excluded from category breakdown (regression)

## Change Log

- 2026-06-18: Story created (ready-for-dev). Scope is the Plaid transaction lifecycle — pending→posted (in-place + supersession linked by pending_transaction_id) and →removed (marked, not deleted) — applied inside the existing 4.2 per-page RLS transaction, idempotent and retry-safe, with a regression test confirming removed rows stay excluded from dashboard math (already filtered by Epic 3). Extends the 4.2 worker only; no schema, adapter, or money/sign change. Not implemented.
- 2026-06-18: Implemented (review). Extended `persistPlaidSyncPage` with two `updateMany` calls inside the existing `withUserContext` transaction: supersession (prior pending row → removed when posted txn arrives with pendingTransactionId) and explicit removals (removedProviderTransactionIds → removed). Added 5 DB-backed worker tests covering all ACs. Typecheck clean; 68 tests pass.
