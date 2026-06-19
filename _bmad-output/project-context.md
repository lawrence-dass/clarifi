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

## Planning docs are sharded — 2026-06-16

- `epics.md` and `architecture.md` are sharded into `planning-artifacts/epics/` and
  `planning-artifacts/architecture/` (each with an `index.md`). The monoliths were moved
  to `archive/planning-pre-shard/`. `create-story`'s discover-inputs prefers the sharded
  folders and can selectively load a single epic shard (e.g. `epics/epic-3-*.md`) — load
  only the epic/section you need, not the whole tree.
- **Caveat:** `bmad-story-automator` step-02 still suggests `planning-artifacts/epics.md`
  as its default epic path. That monolith is archived — when prompted, point it at the
  relevant shard (e.g. `planning-artifacts/epics/epic-2-smart-categorization.md`).
- Completed Epic-1 story files live in `archive/epic-1-completed/`; their `epics.md#…` /
  `architecture.md#…` anchors are historical and intentionally left unmigrated.

## Learnings from Story 2.2 (merchant cache) — 2026-06-16

- The merchant cache (`apps/api/src/modules/categorization/merchant-cache.ts`, Redis) has
  **no invalidation path** — entries only expire via a 30-day TTL or get overwritten by a
  new LLM categorization. **Story 2.3 (override & correction learning) must add a cache
  update/invalidate hook** so a user override immediately beats the cached/LLM category
  for that merchant and re-seeds the cache reflecting the correction. Guardrail: a `user`
  override always wins (`category_source` provenance).
- Normalization treats person-to-person transfers/payments as non-merchant (returns
  `null`) and strips the holder name, so names never reach `merchantName` or the cache
  key. Don't reintroduce a path that derives a merchant from `PAYMENT/TRANSFER … TO/FROM
  <name>` or Interac/e-transfer strings (AC #6 / PIPEDA).

## Learnings from Epic 3 UI + Epic 4 (Plaid) — 2026-06-18

- **`@clarifi/shared` root barrel pulls Prisma into the bundle.** `src/index.ts` re-exports
  `prisma.ts` + generated Prisma client, so importing from `@clarifi/shared` in **client/browser**
  code drags Prisma in. Web code must import client-safe values from dedicated subpaths
  (e.g. `@clarifi/shared/money-display` for `formatCents`). Epic-3 UI worked around the
  `Category` enum by defining a local client-safe list. **Open cleanup:** add a
  `@clarifi/shared/enums` subpath (mirroring `/money-display`) so web stories (Epic 6 query UI,
  Epic 7 consent UI) stop duplicating enum values.
- **Webhook → worker tenancy:** an unauthenticated webhook resolves its owner via a **base
  Prisma client** lookup of the RLS-protected row by a unique key (`PlaidItem.itemId`), mirroring
  the RefreshToken `token_hash` pre-auth pattern, then does user-data writes under
  `withUserContext(userId)`. Reuse this for any future provider/webhook ingestion.
- **Plaid sign is inverted** (positive = outflow); normalized once in `lib/plaid-adapter.ts`
  (`-dollarsToCents`). Never re-reason about Plaid's sign downstream.
- **`ENCRYPTION_KEY` is required at boot** (32 bytes, AES-256-GCM in `lib/crypto.ts`). The API
  won't start without it — set it in every env (CI/Render) alongside Plaid/Anthropic keys.
