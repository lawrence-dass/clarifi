---
risk_tier: 2
baseline_commit: 493160c
context:
  - _bmad-output/planning-artifacts/epics/epic-10-reliability-hardening.md
  - apps/api/src/modules/nl-query/query.service.ts
  - apps/api/src/lib/app-error.ts
  - apps/api/src/middleware/error.ts
  - CLAUDE.md
---

# Story 10.3: NL-query graceful degradation when the LLM is unavailable

Status: done

## Story

As a user, I want a clear message when the query assistant can't answer right
now, so that I'm not shown a scary "Internal server error".

## Context / Bug

`runNLQuery` calls `generateQueryIR` (the LLM step via the gateway). When the LLM
is unavailable — no/invalid `ANTHROPIC_API_KEY`, network failure, rate limit, or
unusable output — the error propagates to the central middleware and renders as a
generic **500 INTERNAL** ("Internal server error"). The user hit this firsthand
during local bring-up. The guardrail spirit (LLM-down ⇒ graceful fallback, as the
anomaly-explain path already does) should apply here too.

## Acceptance Criteria

1. When the LLM/IR-generation step fails, the route returns **503** with the
   error contract `{ error: { code: "LLM_UNAVAILABLE", message } }` and a friendly
   message, instead of a 500. The deterministic compile/execute path is unchanged.
2. The original cause is logged server-side (not leaked to the client).
3. A successful query is unaffected (same response shape).
4. Typecheck + the api suite pass (`pnpm verify:story`).

## Implementation

- `lib/app-error.ts`: add `serviceUnavailable(code, message)` → AppError(503).
- `query.service.ts`: wrap only `generateQueryIR` in try/catch; on failure log the
  cause and throw `serviceUnavailable("LLM_UNAVAILABLE", …)`. `executeQueryIR`
  (compile + read-only role + AST allowlist + 2s timeout) is untouched.
- `query.service.test.ts`: LLM failure → 503 AppError and execute not reached;
  happy path → shaped response.

## Completion Notes

- Scope is error-mapping only; the NL→IR→SQL guardrail logic (IR schema, compiler,
  validator, read-only role) is not touched. AC1/AC2 → service test (503 + execute
  not called) + console.warn; AC3 → happy-path test; AC4 → `verify:story`.

## Change Log

- 2026-06-21: Implemented and verified; graceful 503 for LLM-unavailable NL queries.
