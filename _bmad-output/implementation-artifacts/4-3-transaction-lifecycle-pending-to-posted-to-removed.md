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

Status: ready-for-dev

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

- [ ] Task 1: Thread removed ids + supersession into the worker (AC: #1, #2, #3, #5)
  - [ ] In `apps/api/src/workers/plaid-sync.worker.ts`, pass `page.removedProviderTransactionIds` into `persistPlaidSyncPage` alongside `added`/`modified` (the adapter already returns them from 4.2).
  - [ ] Inside the existing per-page `withUserContext` transaction (do not add a second transaction):
    - Upsert added+modified as today (in-place pending→posted falls out of the upsert `update` setting `status` from `transaction.pending`).
    - **Supersession:** for each added/modified row with a non-null `pendingTransactionId`, `updateMany` the prior row in the same account (`provider: plaid`, `accountId`, `providerTransactionId == pendingTransactionId`) to `status = removed`. Use `updateMany` (no-op if absent) so it's idempotent and ownership-safe under RLS.
    - **Removed:** `updateMany` rows in this item's accounts where `providerTransactionId IN removedProviderTransactionIds` to `status = removed` (kept, not deleted).
  - [ ] Keep the cursor update last in the same transaction (as 4.2).

- [ ] Task 2: Verify dashboard exclusion (AC: #4)
  - [ ] Confirm `transactions.service.ts` aggregations (and `aggregateCategorySpendByCurrency`) already filter `status: { not: TransactionStatus.removed }` — they do; do not change them. Add a regression test (in the transactions suite or the worker test) proving a `removed` transaction is excluded from `GET /transactions/category-breakdown`.

- [ ] Task 3: Tests & verification (AC: #1–#7)
  - [ ] Extend `apps/api/src/workers/plaid-sync.worker.test.ts` (fake adapter, `hasDb` skip): in-place post; supersession (old pending → removed, new posted linked); removed ids → removed (row persists with `status = removed`); unknown removed id ignored; idempotent re-run; and a removed-row-excluded-from-breakdown regression (seed + call the breakdown service/route).
  - [ ] Run `pnpm --filter @clarifi/api typecheck` and the worker + transactions tests (migration `0007` applied). `--testTimeout=40000 --hookTimeout=40000` if the DB timeout trips.

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

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-18: Story created (ready-for-dev). Scope is the Plaid transaction lifecycle — pending→posted (in-place + supersession linked by pending_transaction_id) and →removed (marked, not deleted) — applied inside the existing 4.2 per-page RLS transaction, idempotent and retry-safe, with a regression test confirming removed rows stay excluded from dashboard math (already filtered by Epic 3). Extends the 4.2 worker only; no schema, adapter, or money/sign change. Not implemented.
