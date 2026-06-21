---
risk_tier: 3
baseline_commit: 3a22ecb
context:
  - _bmad-output/planning-artifacts/epics/epic-10-reliability-hardening.md#Story 10.1
  - apps/api/src/queues/categorize.outbox.ts
  - apps/api/src/queues/categorize.queue.ts
  - apps/api/src/workers/index.ts
  - apps/api/src/workers/categorize.worker.ts
  - CLAUDE.md
---

# Story 10.1: Durable categorization recovery

Status: done

## Story

As a user, I want my imported transactions to get categorized even if a worker
job fails, so that the dashboard isn't silently left empty.

## Context / Bug

`categorize.outbox.ts` `dispatchCategorizationEvent` marks the outbox row
`processed: true` immediately after `enqueueCategorize` (job added to Redis), not
after the job *succeeds*. A categorize job that exhausts its 3 BullMQ attempts
lands in the failed set; the drainer only re-dispatches `processed: false` rows,
so nothing retries. Transactions stay `category = null` with no recovery — this is
what stranded the sample-CSV import this session (33 rows uncategorized until a
manual re-trigger).

## Acceptance Criteria

1. A periodic **reconciliation sweep** runs in the worker process: it finds
   transactions with `category IS NULL` and `status != removed`, grouped by
   account, and re-enqueues a categorize job for each such account.
2. **Grace window:** transactions created within a recent grace period (default
   ~2 min) are *not* swept — they're likely still being processed by the fast
   path; only genuinely-stuck rows are re-enqueued.
3. **Poison guard (max age):** transactions older than a max age (default ~24h)
   are not re-enqueued, so a permanently-unprocessable row can't loop forever.
4. **Idempotent & safe:** the categorize job already updates only `category: null`
   rows, so a re-enqueue that races a succeeding job is a no-op. The sweep uses
   the base client for the cross-tenant scan (like the webhook→worker owner
   lookup); the categorize job itself runs under `withUserContext` (RLS) as today.
5. **Wired & bounded:** the sweep starts/stops with `startWorkers()` on a sane
   interval (default ~5 min), `unref()`'d, errors swallowed per-tick (never kills
   the worker), and skips cleanly when Redis isn't configured.
6. **Tested:** a unit test (mocked enqueue + a DB-backed or mocked query) proves
   the sweep re-enqueues a stale account, skips in-grace rows, and skips too-old
   rows. Typecheck + the api suite pass (`pnpm verify:story`).

## Approach

Reconciliation sweep as the durability backstop (source of truth = uncategorized
transactions, not an outbox flag). Keep the outbox for the timely fast path. This
is smaller, idempotent, and self-healing vs. threading the outbox id through the
job and marking processed-on-completion (brittle because the unit of work is a
moving target). `Transaction` has `userId` directly (`@@index([userId, category]`),
so the grouped scan needs no Account join.

## Tasks

- [x] `apps/api/src/queues/categorize.reconcile.ts`: `requeueStaleCategorization({ graceMs, maxAgeMs })` (groupBy account/user on stale `category: null` rows → `enqueueCategorize`) + `startCategorizeReconciler(intervalMs)` (setInterval, unref, swallow errors, opportunistic first run). Defaults: grace 2m, maxAge 24h, interval 5m.
- [x] Skip when `redisConfigError(config.REDIS_URL)` is set (don't enqueue into a dead Redis).
- [x] Wire start/stop into `workers/index.ts` alongside the outbox drainers.
- [x] Unit test (`categorize.reconcile.test.ts`): re-enqueue per stuck account + correct WHERE (category null / not removed / grace<maxAge bounds); Redis-down → no scan/enqueue; custom windows honoured. `index.test.ts` updated to assert the reconciler starts.
- [x] `pnpm verify:story` green (0 skips); tripwire reviewed — base-client read only, all writes stay in the RLS-protected job.

## Completion Notes

- Implemented the reconciliation sweep (Approach above). Base-client cross-tenant
  **read** only (groupBy on `Transaction.userId`/`accountId`); all writes remain in
  the categorize job under `withUserContext`. Idempotent via the job's existing
  `category: null` update guard.
- AC traceability: AC1 → `requeueStaleCategorization` enqueues per account (test 1);
  AC2/AC3 → grace `lt` + maxAge `gte` bounds on `createdAt` (tests 1 & 3); AC4 →
  base-client read + no writes (code/tripwire); AC5 → Redis guard (test 2) + wiring
  in `index.test.ts`; AC6 → tests + `verify:story`.
- Defaults are conservative: 2-min grace (don't fight the fast path), 24-h maxAge
  (poison guard), 5-min interval.

## Pre-Review Due Diligence

- **AC→test:** map AC1–AC6 to the unit test + gate; record in Completion Notes.
- **Guardrail tripwire (Tier 3 — outbox/worker/RLS):** the sweep does a base-client
  cross-tenant *read* only (no writes); all writes still go through the categorize
  job under `withUserContext`. No money/sign/idempotency-key change. Confirm
  `git diff --name-only` stays within the queue/worker files.
- **Edge cases:** empty result; an account whose rows all just imported (in grace);
  a row stuck > maxAge (skipped, not looped); Redis down (skip, no throw); the sweep
  racing a succeeding job (no-op via `category: null` guard).
- **Scope:** api-only; no schema/migration; reuse `enqueueCategorize`.

## Change Log

- 2026-06-20: Story created (in-progress) and implementation started.
