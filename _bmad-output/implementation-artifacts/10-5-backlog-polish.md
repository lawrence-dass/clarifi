---
risk_tier: 2
baseline_commit: 1cbd67d
context:
  - _bmad-output/planning-artifacts/epics/epic-10-reliability-hardening.md
  - apps/api/src/modules/categorization/merchant-cache.ts
  - apps/web/src/components/error-state.tsx
  - apps/web/src/features/anomaly/anomaly-feed.tsx
---

# Story 10.5: Epic 10 backlog polish

Status: done

Three small hardening/polish items found running the app end to end.

## 1. Merchant cache "unavailable" on cold/remote Redis

**Bug:** the categorize worker logged "merchant cache unavailable — degrading to
LLM" even with Redis connected. Cause: the cache's own ioredis client used a 1s
`commandTimeout`, too tight to cover the first command's connect + TLS handshake
to a remote provider (Upstash), so the first GET spuriously timed out.

**Fix:** `merchant-cache.ts` — `commandTimeout` 1s → 3s + explicit `connectTimeout`
5s. Still fails fast on a real outage (degrades to LLM), but tolerates remote
first-command latency. `enableOfflineQueue: false` / `maxRetriesPerRequest: 1`
unchanged.

## 2. Off-token error UI

**Fix:** `error-state.tsx` used raw `red-*` Tailwind classes; migrated to the
`danger` design token (`border-danger/30 bg-danger/10 text-danger`).

## 3. Reuse the shared money formatter

**Fix:** `anomaly-feed.tsx` hand-rolled `formatAmount` (`/100).toFixed(2)`); now
delegates to `@/lib/format-money` `formatMoney(Math.abs(cents), currency)` for
locale/currency consistency. Display-only (magnitude); no money arithmetic.

## Verification

- web typecheck + build (11/11 routes; one flaky Turbopack prerender on a re-run,
  unrelated) + web suite (29 tests) pass.
- api typecheck + merchant-cache test (3) pass. The timeout change isn't unit-
  testable (connection config); validated by reasoning + no regression.

## Change Log

- 2026-06-21: Merchant-cache timeout, error-state token, anomaly-feed formatter.
