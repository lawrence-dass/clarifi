# Epic 10: Reliability & Hardening

Post-feature reliability pass. Close correctness/durability gaps and rough edges
found while running the app end-to-end (Epic 9 + local-dev bring-up). No new
product surface — make the existing pipeline durable and degrade gracefully.

**FRs covered:** none new — hardening of existing FRs (ingestion/categorization,
NL-query, notifications).

## Story 10.1: Durable categorization recovery

As a user,
I want my imported transactions to get categorized even if a worker job fails,
So that the dashboard isn't silently left empty.

**Context / bug:** the outbox marks a row `processed: true` when the categorize
job is *enqueued* (`categorize.outbox.ts` `dispatchCategorizationEvent`), not when
it *succeeds*. A job that exhausts its BullMQ retries lands in the failed set and
is never re-dispatched (the drainer only looks at `processed: false`). Result:
transactions stay uncategorized with nothing retrying — exactly what stranded the
sample-CSV import this session.

**Acceptance Criteria:**

**Given** transactions left uncategorized past a grace period (job failed/lost)
**When** the worker is running
**Then** a periodic reconciliation re-enqueues categorization for those accounts
(idempotent — only `category IS NULL`, non-removed rows), bounded by a max age so
a genuinely-unprocessable row can't loop forever
**And** in-flight/just-imported transactions inside the grace window are not
re-enqueued, and the sweep runs under the same RLS/least-privilege rules as the
rest of the worker.

**Approach (recommended):** a **reconciliation sweep** as the durability backstop
— source of truth is "are there uncategorized transactions?", not an outbox flag.
Keep the outbox for the timely fast-path dispatch; the sweep catches anything the
fast path dropped. Chosen over "mark outbox processed on job completion + dead-
letter" because the unit of work ("all uncategorized txns for an account") is a
moving target that makes a `processed` flag brittle; the sweep is smaller,
idempotent, and self-healing.

## Story 10.2: Bound categorize work to the transaction budget

As a developer,
I want the categorize batch to fit within a sane transaction window regardless of
DB latency,
So that categorization doesn't fail on slow/remote databases.

**Context:** `7548241` raised the `withUserContext` transaction timeout to 30s as
a bound. The real fix is to do less per transaction.

**Acceptance Criteria:**

**Given** a categorize batch against a remote DB
**When** the worker applies results + runs anomaly detection
**Then** the work is chunked (or anomaly detection runs outside the categorization
transaction) so each transaction stays well within budget
**And** no batch fails with P2028, and per-row failures don't roll back the batch.

## Story 10.3: NL-query graceful degradation (done)

The `/query/nl` route returned a raw 500 when the LLM was unavailable; now returns
a 503 `LLM_UNAVAILABLE` with a friendly message (mirrors the anomaly-explain
templated fallback). See `10-3-nl-query-graceful-degradation.md`.

## Story 10.4: Isolated test database (done)

`verify:story` flaked when a worker ran against the same Supabase DB the tests
assert on (its drainers mutate outbox rows mid-test). Added `TEST_DATABASE_URL`
to redirect the suite to an isolated DB + hardened the exact-count outbox/webhook
tests. See `10-4-isolated-test-db.md`.

## Backlog (smaller hardening items — promote to stories when picked up)

- **"merchant cache unavailable" degradation:** the Redis-backed merchant cache
  logs unavailable even with Redis connected — investigate the cache connection;
  it's non-fatal (falls back to LLM) but shouldn't be down.
- **Off-token error UI:** `error-state.tsx` still uses raw `red-*` Tailwind classes
  — migrate to the `danger` design token (Epic 9 leftover).
- **Reuse shared money formatter:** `anomaly-feed.tsx` hand-rolls `formatAmount`
  instead of `@/lib/format-money`.
