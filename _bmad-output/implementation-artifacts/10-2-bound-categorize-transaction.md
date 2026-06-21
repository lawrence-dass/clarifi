---
risk_tier: 3
baseline_commit: 6296db2
context:
  - _bmad-output/planning-artifacts/epics/epic-10-reliability-hardening.md#Story 10.2
  - apps/api/src/workers/categorize.worker.ts
  - packages/shared/src/prisma.ts
  - CLAUDE.md
---

# Story 10.2: Bound categorize work to the transaction budget

Status: done

## Story

As a developer, I want the categorize batch to fit within a sane transaction
window regardless of DB latency, so that categorization doesn't fail on
slow/remote databases.

## Context / Bug

`7548241` raised the `withUserContext` transaction timeout to 30s as a stopgap
because the categorize worker applied an entire batch (per-row `updateMany` +
anomaly baseline reads) inside **one** transaction — its size grew with the
batch, so a big batch on a remote DB still risked P2028. The real fix is to do
less per transaction.

## Acceptance Criteria

1. The write+detect work is **chunked** into small transactions (constant
   `TX_CHUNK_SIZE` rows each), so a transaction's size no longer grows with the
   batch — it's bounded regardless of how many rows the LLM batch produced.
2. No batch fails with P2028; the 30s whole-batch bound is removed (replaced by a
   modest per-chunk safety timeout, not the mechanism).
3. Per-chunk failures don't roll back already-committed chunks; a retry skips what
   already landed (the existing `category: null` update guard).
4. Behaviour is otherwise unchanged: every uncategorized row is still
   categorized, merchant cache + judge + fallback paths intact. Typecheck + the
   DB-backed categorize worker suite pass.

## Implementation

- `categorize.worker.ts`: replace `BATCH_TX_OPTIONS` (30s, whole batch) with
  `TX_CHUNK_SIZE = 5` + a `chunk()` helper. Both the cache-hit and cache-miss
  loops now iterate `chunk(rows, TX_CHUNK_SIZE)`, opening a fresh
  `withUserContext` per chunk with a 15s safety timeout. The LLM call, judge, and
  merchant-cache writes stay outside the transaction as before; `cacheWrites` is
  still collected across chunks.

## Completion Notes

- Transaction size is now O(TX_CHUNK_SIZE), independent of CATEGORIZE_BATCH_SIZE —
  a 100-row import becomes 20 small chunks, none at timeout risk. Chunking also
  isolates failures (a bad chunk doesn't roll back earlier ones).
- AC1/AC2 → chunked loops + bound removed; AC3 → independent per-chunk
  transactions + `category: null` retry guard; AC4 → categorize worker suite
  (17 DB-backed tests, incl. "processes every uncategorized transaction across
  multiple batches") passes; typecheck clean.
- Did not run a full isolated `verify:story` (no local Postgres here; the shared
  DB + live worker makes it flaky — see 10.4). The directly-relevant DB-backed
  suite is green and deterministic (scoped to its own user).

## Change Log

- 2026-06-21: Chunked the categorize write+detect transactions; removed the 30s
  whole-batch timeout bound.
