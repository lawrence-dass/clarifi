# Clarifi — Cross-Story Learnings

Lean, append-only record of things discovered *during* implementation that future
stories need but that aren't obvious from CLAUDE.md, the architecture docs, or the
code itself.

**How to use**
- `session-start` loads this file automatically; keep it short (target < 200 lines).
- Add entries via `session-end` (Mode 2, Step 5) under a dated, story-scoped heading.
- Do **not** duplicate CLAUDE.md guardrails, architecture decisions, or sprint state —
  link to them by path instead. Record only the non-obvious delta.

---

## Learnings from Story 2.1 (LLM categorization) — 2026-06-15

- **Single LLM egress point:** `apps/api/src/lib/llm-gateway.ts` is the *only* file that
  imports `@anthropic-ai/sdk`. All future LLM work (2.4 LLM-as-judge, 5.4 anomaly
  explanations, 6.1 NL→IR) must route through this gateway — never import the SDK
  elsewhere. Anonymization is applied at this boundary via `apps/api/src/lib/anonymize.ts`.
- **Worker topology:** BullMQ workers run as a *separate* process — `src/worker.ts`,
  started with `pnpm --filter @clarifi/api worker` — not booted inside `server.ts`.
  New async work should follow this entrypoint pattern.
- **Categorization model is env-configurable:** defaults to `claude-haiku-4-5` via
  `CATEGORIZATION_MODEL`; batch size via `CATEGORIZE_BATCH_SIZE` (default 25). Chosen
  for cost on high-volume classification — bump the env var for accuracy if needed.
- **Enqueue durability:** ingestion records a durable outbox request before dispatching
  the categorize job, so a Redis hiccup never fails the import and the worker can drain
  unprocessed requests. Reuse this pattern for any ingestion-triggered async work.
