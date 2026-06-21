---
risk_tier: 2
baseline_commit: e603e6b
context:
  - _bmad-output/planning-artifacts/epics/epic-10-reliability-hardening.md
  - apps/api/vitest.config.ts
  - _bmad/handoff/mobile-workflow.md
---

# Story 10.4: Isolated test database (kill gate flakiness)

Status: done

## Story

As a developer, I want `verify:story` to be deterministic, so that a red gate
means a real failure — not a worker racing the test DB.

## Context / Bug

`verify:story` flakes intermittently. Root cause: DB-backed tests assert **exact
row counts** (e.g. the plaid-sync/categorize outbox + webhook tests on
`PLAID_SYNC_REQUESTED_EVENT` / `categorization.requested` rows), and when a
**worker process is live against the same Supabase DB**, its outbox drainers /
categorize jobs mutate those rows mid-test. `fileParallelism` is already off, so
it's not cross-file races — it's an external process sharing the DB. `beforeEach`
cleanup can't stop a concurrent worker; the only real fix is an isolated DB.

## Acceptance Criteria

1. The test suite can run against an **isolated** database via `TEST_DATABASE_URL`
   (+ optional `TEST_DIRECT_URL`): when set, `vitest.config.ts` redirects
   `DATABASE_URL`/`DIRECT_URL` to it before any Prisma import. Unset ⇒ existing
   behaviour (uses `DATABASE_URL`).
2. Documented in `.env.example` and `mobile-workflow.md` (point it at a throwaway
   local Postgres; a live worker on the dev DB no longer interferes).
3. Defense in depth: the exact-count outbox/webhook tests also clean their rows
   `beforeEach` (not just `afterEach`), so a row left by a prior run can't leak in.
4. Typecheck passes; the override is proven (placeholder ⇒ DB tests skip); the
   hardened tests pass against the default DB.

## Completion Notes

- `vitest.config.ts`: opt-in `TEST_DATABASE_URL`/`TEST_DIRECT_URL` override. Test
  infra only — no production/runtime path touched.
- `beforeEach` cleanup added to `plaid-sync.outbox.test.ts` and
  `webhooks.routes.test.ts` (categorize outbox was hardened in 10.x earlier).
- Verified: `pnpm --filter @clarifi/api typecheck` clean; with
  `TEST_DATABASE_URL=…placeholder…` the plaid-sync outbox tests **skip** (override
  propagated); with it unset, the plaid-sync + categorize outbox + webhook tests
  pass (8 tests) against the dev DB.
- **Not verifiable here:** a full isolated green `verify:story` — this machine has
  no local Postgres/Docker. With `TEST_DATABASE_URL` pointed at a local Postgres
  (and no worker on it), the gate is deterministic.

## Change Log

- 2026-06-21: Implemented isolated-test-DB support + outbox/webhook test hardening.
