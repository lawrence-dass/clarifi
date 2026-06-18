---
risk_tier: 3
baseline_commit: 2785cb1
context:
  - _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.2
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Infrastructure & Deployment
  - _bmad-output/implementation-artifacts/4-1-plaid-link-connection-token-encryption.md
  - _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md
  - apps/api/src/queues/categorize.outbox.ts
  - apps/api/src/lib/plaid-adapter.ts
  - apps/api/src/lib/crypto.ts
  - packages/shared/src/canonical.ts
  - CLAUDE.md
---

# Story 4.2: Webhook ingestion with outbox & cursor sync

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want new transactions to arrive reliably after I connect a bank,
so that nothing is lost or duplicated.

**Scope note:** Backend only. Webhook → durable outbox → ack; an outbox-backed worker calls Plaid `transactions/sync` with the stored cursor and upserts **added + modified** transactions idempotently, advancing the cursor. **Removed transactions and the pending→posted lifecycle are Story 4.3** — this story must consume `removed`/`next_cursor` from the sync response without losing the cursor, but does not implement the full lifecycle transitions. No UI.

## Acceptance Criteria

1. **Fast, safe webhook:** `POST /webhooks/plaid` verifies the webhook, and for a `TRANSACTIONS` `SYNC_UPDATES_AVAILABLE` event writes a durable outbox row and returns `200` immediately. The handler does **no** Plaid API call, no transaction sync, and no LLM work — it only verifies, writes the outbox row, and acks. Unknown/irrelevant webhook types are acked (`200`) and ignored.
2. **Verification:** the webhook's authenticity is verified (Plaid `Plaid-Verification` JWT against the webhook verification key) before any outbox write; an unverified/invalid webhook is rejected (`400`/`401`) and writes nothing. The verifier is injectable so tests don't hit Plaid.
3. **Outbox durability (reuse Epic 2 pattern):** the event (`eventType = "plaid.sync_requested"`, payload `{ itemId, webhookCode }`) is persisted to the existing `Outbox` table; a Redis/worker hiccup never loses it (drainer + `attempts`), mirroring `categorize.outbox.ts`. The webhook ack does not depend on the sync succeeding.
4. **Dispatch & item resolution:** an outbox-backed worker resolves the `PlaidItem` by its unique `itemId` using the **base Prisma client** (a system/pre-auth lookup, like the RefreshToken `token_hash` lookup — the webhook carries no user session), reads the stored `cursor`, and decrypts the access token via `decryptSecret` (`lib/crypto.ts`). The token is used only server-side and never logged or returned.
5. **Cursor sync (paged):** the worker calls the adapter's `transactions/sync` with the stored cursor and loops while `has_more`, processing each page.
6. **Idempotent upsert (guardrail):** added + modified transactions are upserted on the unique `(account_id, provider_transaction_id)` key under `withUserContext(userId)` (the item's owner); re-processing the same cursor/page never creates duplicates. At-least-once delivery + the unique upsert = exactly-once effect.
7. **Sign normalization (guardrail):** Plaid's amount convention (positive = money out) is normalized **once, in the adapter**, to the user's perspective — outflow negative, inflow positive — as integer cents (`dollarsToCents`), mapped to `CanonicalTransaction`. No part of the app downstream re-reasons about Plaid's sign.
8. **Cursor advance & retry-safety:** the `PlaidItem.cursor` is persisted as pages succeed, so a failed run resumes from the last good cursor without re-ingesting or losing data; a failure increments outbox `attempts` and leaves the row unprocessed for retry — never duplicating transactions or advancing the cursor past unprocessed data.
9. **Post-sync categorization:** after new transactions land, categorization is enqueued for the affected account(s) by **reusing `requestCategorization`** (the Epic 2 outbox→BullMQ path) — not reimplemented. The webhook/ack path is never blocked by categorization/LLM.
10. **Tests:** webhook acks fast + writes the outbox row + performs no sync in-handler (fake verifier/adapter); unverified webhook → rejected, no outbox row; dispatcher upserts added+modified idempotently (re-run → no dupes); sign normalization (Plaid positive outflow → negative cents); cursor advances and a re-run resumes from it; failure mid-sync → `attempts++`, not processed, no dupes, cursor not lost; categorization enqueued. DB-backed tests use the `hasDb` skip; fake Plaid client/verifier; no real network/LLM.

## Tasks / Subtasks

- [x] Task 1: Adapter — `transactions/sync` + sign normalization (AC: #5, #7)
  - [x] Extend `apps/api/src/lib/plaid-adapter.ts` (the only `plaid` importer) with `syncTransactions(accessToken, cursor?) -> { added: CanonicalTransaction[]; modified: CanonicalTransaction[]; removedProviderTransactionIds: string[]; nextCursor: string; hasMore: boolean }`. Map Plaid transactions → `CanonicalTransaction`, normalizing sign once: Plaid `amount > 0` is an outflow → store negative cents; inflow positive. Use `dollarsToCents`; `providerTransactionId = transaction_id`. Keep the client injectable.
  - [x] Map `pending`/`account_id` fields through so Story 4.3 can build the lifecycle, but do not implement lifecycle transitions here.

- [x] Task 2: Webhook endpoint (AC: #1, #2, #3)
  - [x] New `apps/api/src/modules/webhooks/` (`webhooks.routes.ts`, `webhooks.controller.ts`), mounted at `/webhooks` in `app.ts`. `POST /webhooks/plaid` is **unauthenticated** (Plaid-originated) — do NOT use `requireAuth`/`withUserContext` here.
  - [x] Verify the Plaid webhook (injectable verifier; real impl validates the `Plaid-Verification` JWT via the webhook verification key). Reject invalid → `4xx`, no side effects.
  - [x] On `SYNC_UPDATES_AVAILABLE` write the `plaid.sync_requested` outbox event and `requestPlaidSync` (enqueue); ack `200`. Ignore+ack other types. No Plaid calls / no sync in the handler.

- [x] Task 3: Sync outbox + queue + worker (reuse Epic 2 pattern) (AC: #3, #4, #8, #9)
  - [x] Mirror `categorize.queue.ts` + `categorize.outbox.ts` + `workers/categorize.worker.ts`: a `transactions.sync` BullMQ queue, a `requestPlaidSync({ itemId })` that writes the outbox row then enqueues, a drainer (`startPlaidSyncOutboxDrainer`, registered in `workers/index.ts`), and a `plaid-sync.worker.ts`.
  - [x] Outbox payload Zod-validated; on dispatch failure increment `attempts` and leave unprocessed (mirror the existing drainer).

- [x] Task 4: Sync service (AC: #4, #5, #6, #7, #8, #9)
  - [x] `processPlaidSyncJob({ itemId }, { adapter?, ... })`: base-client `prisma.plaidItem.findUnique({ where: { itemId } })` → `{ userId, accessTokenEncrypted, cursor }`; `decryptSecret` the token; loop `syncTransactions(token, cursor)` while `hasMore`.
  - [x] For each page, inside `withUserContext(userId)`: upsert added+modified on `(accountId, providerTransactionId)` (map each canonical txn to its `Account` via `providerAccountId` — the accounts exist from 4.1; skip/log txns whose account isn't found), then persist the new `cursor` on the `PlaidItem`. Keep money in `bigint` cents; never float.
  - [x] After ingesting, `requestCategorization` for each affected account. Never log the token or raw descriptions.

- [x] Task 5: Config (AC: #2)
  - [x] Add any webhook-verification config needed (e.g. allow the verifier to fetch/cache the Plaid webhook verification key; reuse `PLAID_*`). Document in `.env.example`. Keep verification injectable/disable-in-test cleanly (no real Plaid in tests).

- [x] Task 6: Tests & verification (AC: #1–#10)
  - [x] Webhook route test (Supertest): valid `SYNC_UPDATES_AVAILABLE` → `200` + one outbox row + adapter/sync NOT called in-handler; unverified → `4xx` + no outbox row; unknown type → `200` + no outbox row.
  - [x] Sync worker test (`hasDb` skip, fake adapter): seed a `PlaidItem` + its `Account`s (4.1 path or direct prisma); a sync page with added+modified → rows upserted with correct **negative** cents for outflows; re-run same cursor/page → no duplicates; cursor persisted and resumed; a thrown adapter error → `attempts++`, unprocessed, no dupes; categorization enqueued (assert `requestCategorization`/outbox row).
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the new tests (migration `0007` applied). Use `--testTimeout=40000 --hookTimeout=40000` if the DB timeout trips.

## Dev Notes

### Risk Tier

Tier 3 — trips **multiple** guardrails: ingestion **sign normalization**, the `(account_id, provider_transaction_id)` **idempotency key**, **outbox/webhook/cursor** reliability, **token decryption**, and **RLS** writes. Run the `CLAUDE.md` tripwire before done (`git diff --name-only`); expected surfaces are the adapter (sign), the upsert key, outbox/queue/worker, `lib/crypto` (decrypt), and `withUserContext`. Keep the full Tier-3 review.

### Source Story Context

Epic 4: connect real banks with reliable, exactly-once sync. 4.2 is the reliable ingestion mechanic. [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.2]

Epic BDD: *Given a Plaid `SYNC_UPDATES_AVAILABLE` webhook, when it is received, then the event is written to the outbox and the webhook is acked immediately (never blocked by LLM work), and the outbox dispatcher calls `transactions/sync` with the stored cursor and upserts idempotently (exactly-once effect), and processing is retried safely on failure without duplicating transactions.* [Source: epic-4-plaid-reliable-ingestion.md#Story 4.2]

### Architecture Guardrails

- **Webhook acks immediately after enqueue; workers own slow work.** HTTP handlers do fast work + enqueue; the webhook never blocks on Plaid/LLM. [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md (Sync/async boundary); CLAUDE.md#Anomaly detection (ack never blocked)]
- **At-least-once outbox + unique upsert = exactly-once effect.** Idempotency key is `(account_id, provider_transaction_id)`. [Source: CLAUDE.md#Money & data model]
- **Sign normalized once, at ingestion, in the adapter** — outflow negative, inflow positive. The rest of the app never thinks about Plaid's convention. [Source: CLAUDE.md#Money & data model]
- **Provider boundary:** the `plaid` SDK stays in `lib/plaid-adapter.ts`; map to `CanonicalTransaction`. [Source: CLAUDE.md#FDX / open banking]
- **RLS:** user-data writes go through `withUserContext(userId)`. The webhook has no session; resolve the item/owner via a base-client lookup by unique `itemId` (the RefreshToken `token_hash` precedent), then write under the owner's context. [Source: CLAUDE.md#Multi-tenancy & query safety; packages/shared/prisma/schema.prisma (RefreshToken comment)]
- **Privacy:** never log the access token or raw transaction descriptions. [Source: CLAUDE.md#Privacy]

### Previous Story Intelligence (reuse)

- **Outbox pattern is built** — `apps/api/src/queues/categorize.outbox.ts` (`requestCategorization`, `drainCategorizeOutbox`, `startCategorizeOutboxDrainer`, dispatch→mark-processed, `attempts++` on failure) + `categorize.queue.ts` + `workers/categorize.worker.ts` + `workers/index.ts` registration. Mirror this exactly for `plaid.sync_requested` / `transactions.sync`. The `Outbox` model is system-level (no RLS). [Source: apps/api/src/queues/categorize.outbox.ts; _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]
- **From 4.1:** `PlaidItem` (encrypted token, nullable `cursor`), `lib/crypto.ts` (`decryptSecret`), `lib/plaid-adapter.ts` (injectable client, canonical mapping via `dollarsToCents`), `Account.plaidItemId`, and the `(provider, providerAccountId)` account upsert. Reuse all. [Source: _bmad-output/implementation-artifacts/4-1-plaid-link-connection-token-encryption.md]
- **Categorization enqueue:** `requestCategorization({ userId, accountId })` is the durable path to recategorize new rows — call it after ingest. [Source: apps/api/src/queues/categorize.outbox.ts]
- **CSV ingestion** (`modules/ingestion/ingestion.service.ts`) shows the `withUserContext` + transaction-write pattern and canonical mapping to mirror for the upsert. [Source: apps/api/src/modules/ingestion/ingestion.service.ts]

### Existing Files To Update / Add

- Update: `apps/api/src/lib/plaid-adapter.ts` (+ `syncTransactions`), `apps/api/src/app.ts` (mount `/webhooks`), `apps/api/src/workers/index.ts` (register the sync drainer), `config.ts` + `.env.example` (verification config if needed).
- Add: `apps/api/src/modules/webhooks/*`, `apps/api/src/queues/plaid-sync.outbox.ts`, `apps/api/src/queues/plaid-sync.queue.ts`, `apps/api/src/workers/plaid-sync.worker.ts`, plus tests. No schema change (the `cursor` column exists from 4.1; `Outbox` exists).

### Implementation Guidance

- Webhook payload: handle `webhook_type = "TRANSACTIONS"`, `webhook_code = "SYNC_UPDATES_AVAILABLE"` (and the initial `INITIAL_UPDATE`/`HISTORICAL_UPDATE` are legacy — sync is cursor-based, so `SYNC_UPDATES_AVAILABLE` is the trigger). The payload includes `item_id`.
- Cursor: pass `undefined`/empty for the first sync; persist `next_cursor` after each successful page; on the final page (`has_more = false`) persist and mark the outbox processed.
- Map canonical txn → `Account` by `providerAccountId` (Plaid `account_id`); the account must already exist (created in 4.1). If an unknown account appears, skip it (log a non-PII warning) rather than fabricate one.
- Keep the webhook handler tiny; all Plaid calls live in the worker/service via the adapter.
- Removed txns + pending→posted lifecycle: capture `removedProviderTransactionIds` and `pending` but defer the actual transitions to 4.3 (don't lose them — 4.3 will consume).

### Testing Standards

- No real Plaid network, no real webhook key — inject a fake verifier and a fake adapter; use the `hasDb` skip for DB-backed worker tests; reuse the register/login harness only where a user context is needed (the sync worker resolves the user from the `PlaidItem`).
- Assert the exactly-once invariant directly: run the same sync page twice and assert one row per `providerTransactionId`; assert outflow amounts are stored **negative**.
- `--testTimeout=40000 --hookTimeout=40000` if the 5s DB timeout trips.

### Project Structure Notes

New webhooks module + sync queue/outbox/worker mirroring Epic 2; adapter gains one method. No schema/migration change. Avoid: doing sync work in the webhook handler, importing the Plaid SDK outside the adapter, logging the token/descriptions, float money math, advancing the cursor on failure, and implementing the removed/lifecycle transitions (4.3).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.2]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Infrastructure & Deployment]
- [Source: _bmad-output/implementation-artifacts/4-1-plaid-link-connection-token-encryption.md]
- [Source: apps/api/src/queues/categorize.outbox.ts]
- [Source: apps/api/src/lib/plaid-adapter.ts]
- [Source: apps/api/src/lib/crypto.ts]
- [Source: apps/api/src/modules/ingestion/ingestion.service.ts]
- [Source: packages/shared/src/canonical.ts]
- [Source: packages/shared/prisma/schema.prisma#Outbox]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#FDX / open banking]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#10 maps to a named test; record the mapping in Completion Notes. Exactly-once (#6), sign normalization (#7), and retry-safety (#8) each need an explicit test.
- **Guardrail tripwire (mandatory, Tier 3 — multiple surfaces):** run `git diff --name-only`. Confirm in the record: (a) the webhook handler does **no** Plaid call / sync / LLM — only verify + outbox + ack; (b) added+modified upsert on `(account_id, provider_transaction_id)` — a re-run creates no duplicates (proven by test); (c) sign normalized once in the adapter (outflow negative), integer cents via `dollarsToCents`, no float; (d) the cursor advances only on success and a failure leaves the outbox row unprocessed with `attempts++` (no cursor loss, no dupes); (e) the access token is decrypted only server-side and never logged/returned; (f) the `plaid` SDK is imported only in the adapter; (g) user-data writes go through `withUserContext(userId)` with the owner resolved via a base-client `itemId` lookup (no body/session user on the webhook). No schema/migration change expected.
- **Edge / failure paths (Edge Case Hunter):** unverified/replayed webhook (reject, no side effect); unknown webhook type (ack, ignore); first sync (no cursor); multi-page `has_more` loop; a page that fails mid-way (resume from persisted cursor, no dupes); a txn for an unknown account (skip, no fabricate); empty sync (no rows, cursor still advances); duplicate webhook delivery (idempotent); token decrypt failure (surfaced, not logged).
- **Reuse first (Blind Hunter / simplify):** mirror `categorize.outbox.ts`/`categorize.queue.ts`/`categorize.worker.ts`; reuse `decryptSecret`, the adapter, `requestCategorization`, `dollarsToCents`, `withUserContext`, and the `Outbox` model. Don't build a second outbox/queue abstraction or a second Plaid client.
- **Scope discipline:** no removed/lifecycle transitions (4.3), no UI, no Plaid SDK outside the adapter, no sync work in the webhook handler. Flag any out-of-scope edit with a rationale.
- **Evidence, not claims:** paste actual `typecheck` + webhook/worker test results (with `0007` applied) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/api typecheck` → passed (`tsc --noEmit`).
- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/api exec vitest run src/lib/plaid-adapter.test.ts src/modules/webhooks/webhooks.routes.test.ts src/queues/plaid-sync.outbox.test.ts src/workers/plaid-sync.worker.test.ts --testTimeout=40000 --hookTimeout=40000` → passed; 4 files, 13 tests.
- Guardrail scan: `rg "from ['\"]plaid['\"]|require\\(['\"]plaid['\"]\\)" apps packages -g "*.ts"` → only `apps/api/src/lib/plaid-adapter.ts`.
- Guardrail scan: no `console.*`, `req.log`, or logger calls in `apps/api/src/modules/webhooks`, `apps/api/src/queues/plaid-sync.*.ts`, or `apps/api/src/workers/plaid-sync.worker.ts`.
- BMAD code review: local Blind Hunter / Edge Case Hunter / Acceptance Auditor review completed. One patch finding was addressed by adding `plaid-sync.outbox.test.ts` coverage for drainer enqueue failure and attempts increment; reran typecheck/tests successfully.

### Completion Notes List

- Implemented backend-only Plaid webhook ingestion: unauthenticated `POST /webhooks/plaid` verifies `Plaid-Verification`, writes a `plaid.sync_requested` outbox row for `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE`, and acks immediately. Unknown/irrelevant webhooks are verified, acked, and ignored.
- Added injectable real webhook verifier using Plaid webhook verification keys via the existing Plaid adapter boundary and `jose`; tests inject a fake verifier, so no real Plaid network is used.
- Added Plaid sync outbox/queue/worker mirroring the Epic 2 pattern: `requestPlaidSync`, `drainPlaidSyncOutbox`, `startPlaidSyncOutboxDrainer`, `transactions.sync` BullMQ queue, and `createPlaidSyncWorker` registered in `workers/index.ts`.
- Added `syncTransactions` to the single Plaid adapter. Plaid positive amounts are normalized once at the adapter boundary to negative Clarifi cents using `dollarsToCents`; inflows become positive cents. The adapter maps added/modified/removed IDs, `account_id`, pending status, and `pending_transaction_id` into canonical data for Story 4.3.
- Worker resolves `PlaidItem` by base-client `itemId`, decrypts `accessTokenEncrypted` only server-side, loops `transactions/sync` while `hasMore`, and writes every successful page under `withUserContext(userId)`.
- Added+modified transactions upsert on `(accountId, providerTransactionId)` and cursor updates happen in the same RLS-scoped transaction per page. A later page failure leaves the outbox row unprocessed with `attempts++`; retry resumes from the last persisted cursor without duplicating prior rows.
- Categorization uses the existing `requestCategorization` path after sync. It is never invoked from the webhook handler and never blocks the webhook ack.
- No schema migration was added; Story 4.1 migration `0007_plaid_items` already supplies `PlaidItem.cursor`.
- AC traceability: AC1/AC2/AC3 covered by `webhooks.routes.test.ts`; AC3 outbox enqueue/drainer failure by `plaid-sync.outbox.test.ts`; AC4/AC5/AC6/AC8/AC9 by `plaid-sync.worker.test.ts`; AC7 by `plaid-adapter.test.ts`; AC10 by the targeted test run above.

### File List

- `_bmad-output/implementation-artifacts/4-2-webhook-ingestion-with-outbox-cursor-sync.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `.env.example`
- `apps/api/src/app.ts`
- `apps/api/src/lib/plaid-adapter.ts`
- `apps/api/src/lib/plaid-adapter.test.ts`
- `apps/api/src/modules/accounts/accounts.routes.test.ts`
- `apps/api/src/modules/webhooks/plaid-webhook-verifier.ts`
- `apps/api/src/modules/webhooks/webhooks.controller.ts`
- `apps/api/src/modules/webhooks/webhooks.routes.ts`
- `apps/api/src/modules/webhooks/webhooks.routes.test.ts`
- `apps/api/src/queues/plaid-sync.outbox.ts`
- `apps/api/src/queues/plaid-sync.outbox.test.ts`
- `apps/api/src/queues/plaid-sync.queue.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/plaid-sync.worker.ts`
- `apps/api/src/workers/plaid-sync.worker.test.ts`
- `packages/shared/src/canonical.ts`

## Change Log

- 2026-06-18: Story created (ready-for-dev). Scope is reliable Plaid ingestion — verified webhook → durable outbox → immediate ack, and an outbox-backed worker that cursor-syncs `transactions/sync`, normalizes sign once in the adapter, and upserts added+modified idempotently on `(account_id, provider_transaction_id)` under RLS, advancing the cursor retry-safely and enqueuing categorization. Removed/lifecycle deferred to 4.3. Reuses the Epic 2 outbox/queue/worker pattern and the 4.1 crypto/adapter/PlaidItem. No schema change. Not implemented.
- 2026-06-18: Implemented Story 4.2 webhook/outbox/cursor sync, sign-normalizing Plaid adapter mapping, RLS-scoped worker upserts, retry-safe cursor handling, and categorization enqueue reuse. Passed API typecheck and targeted webhook/outbox/worker/adapter tests. BMAD code review completed with all findings fixed. Status set to done.
