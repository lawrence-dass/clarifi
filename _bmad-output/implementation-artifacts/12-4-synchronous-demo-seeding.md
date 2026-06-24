---
baseline_commit: 6897803
risk_tier: 3
epic: 12
story: 12.4
guardrail_surfaces:
  - LLM gateway / cost (categorization now runs inline in the mint request)
  - anomaly detection (detectAndPersist — not idempotent, hence the suppress)
  - RLS / withUserContext (inline processing under tenant context)
  - ingestion enqueue (additive skipCategorizeEnqueue flag)
---

# Story 12.4: Fully-Loaded Demo (Synchronous Seeding)

Status: done

## Story

As a prospective reviewer,
I want the demo dashboard fully populated the moment I land in it,
so that categories and anomalies are visible immediately, with no refresh.

## Acceptance Criteria

1. **AC1 — Inline categorization + detection.** A demo mint (`POST /demo/session`, either kind) runs categorization AND anomaly detection **synchronously** before the 201, reusing the worker's `processCategorizeJob` per account. The dashboard is populated on first load.
2. **AC2 — Async enqueue suppressed (no double-detect).** The demo path does **not** enqueue the async categorize job (CSV via `importCsv({ skipCategorizeEnqueue: true })`, Plaid via a no-op `requestCategorizationFn`). This is required because `detectAndPersist` is not idempotent — a racing worker run would create duplicate anomalies.
3. **AC3 — Best-effort.** Inline categorization uses `fallbackOnError: true` and is wrapped per-account — an LLM hiccup leaves the demo loadable (uncategorized) rather than failing the mint.
4. **AC4 — No blast radius.** Non-demo ingestion is unchanged (still async); typecheck + DB-backed tests pass.

## Tasks / Subtasks

- [x] **Task 1 — `importCsv` skip-enqueue flag (AC2)** — additive `skipCategorizeEnqueue?: boolean` on `ImportCsvInput`; when true, don't call `requestCategorization`. Default false (normal path unchanged).
- [x] **Task 2 — Inline categorize in provisioning (AC1, AC2, AC3)** — `demo.service.ts`: CSV seed passes `skipCategorizeEnqueue: true`; Plaid seed passes a no-op `requestCategorizationFn`; after seeding, `categorizeDemoSynchronously` runs `processCategorizeJob({ userId, accountId }, { fallbackOnError: true })` per account (best-effort).
- [x] **Task 3 — Tests** — demo.service/demo.routes mock `processCategorizeJob` (no real LLM); assert it runs inline + the async enqueue is **not** called; ingestion's normal enqueue assertion still green.

## Dev Notes

- **Reuse:** `processCategorizeJob` (worker) is a standalone function (categorize → cache/LLM → `detectAndPersist`). Called inline here instead of via BullMQ. No new logic.
- **Why suppress, not just run inline:** `persist.detectAndPersist` creates Anomaly rows unconditionally (no per-transaction dedupe), and the categorize loop runs detection even when its `category:null` update matches 0 rows — so a worker run racing the inline run would double-detect. Suppressing the enqueue removes the race; the demo is ephemeral so it needs no async durability backstop.
- **Cost/latency:** categorization LLM cost is unchanged (same work, now synchronous); the mint takes ~5–10s and the button already shows "Preparing your demo…". Bounded by 12.2's per-IP rate limit + per-session quota.
- **Guardrails:** inline run is under `withUserContext`; LLM egress still only via `lib/llm-gateway` (through the reused `processCategorizeJob`); no migration; no change to the worker/detector/persist logic.

### Files

- `apps/api/src/modules/ingestion/ingestion.service.ts` (`skipCategorizeEnqueue`)
- `apps/api/src/modules/demo/demo.service.ts` (inline categorize + suppressed enqueue)
- `apps/api/src/modules/demo/demo.service.test.ts`, `demo.routes.test.ts` (mock worker, assert inline)

## Pre-Review Due Diligence

- **AC→test:** AC1/AC2 → demo.service.test asserts `processCategorizeJob` called inline + `requestCategorization` not called; demo.routes.test stubs the worker so the route doesn't hit the LLM. AC4 → ingestion.routes.test still asserts the normal enqueue (default flag). Behavior of categorize+detect itself is covered by the existing worker/detector/persist suites + manual live verification (CSV demo → 4 critical incl. Birks $6,800; Plaid demo → ~10 critical).
- **Tripwire:** `ingestion.service.ts` (additive flag), `demo.service.ts` (inline). No change to `withUserContext`, `processCategorizeJob`/detector/persist internals, `lib/llm-gateway`, 12.2 middleware, or migrations. No new dependency.
- **Edge:** LLM failure → fallback "other", mint still succeeds; Plaid-unavailable still 503 (unchanged); re-run idempotent (category:null guard).

## Dev Agent Record

### Agent Model Used
Claude Opus 4.8 (claude-opus-4-8) — solo dev cycle.

### Completion Notes List
Implemented inline categorization + anomaly detection for demo provisioning, with the async enqueue suppressed to avoid duplicate anomalies. typecheck PASS; `verify:story` 395 passed / 0 skipped (1 pre-existing unrelated auth-refresh failure); touched tests (demo.service 8, demo.routes 4, ingestion.routes 8) green in isolation.

### File List
- apps/api/src/modules/ingestion/ingestion.service.ts
- apps/api/src/modules/demo/demo.service.ts
- apps/api/src/modules/demo/demo.service.test.ts
- apps/api/src/modules/demo/demo.routes.test.ts
- _bmad-output/planning-artifacts/epics/epic-12-public-demo-access.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log
- 2026-06-22 — Story 12.4: block the demo mint until categorization + anomaly detection finish (inline `processCategorizeJob`), async enqueue suppressed to prevent duplicate anomalies.
