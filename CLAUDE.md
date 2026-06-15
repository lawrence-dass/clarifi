# CLAUDE.md — Clarifi

Guidance for Claude Code when working in this repo. Read this before writing code.

## What Clarifi is

A Canadian fintech personal-finance intelligence app: it categorizes bank transactions, detects spending anomalies, and answers natural-language questions about a user's own financial data. Built with Canadian open banking (Consumer-Driven Banking / FDX) in mind.

**Why it exists:** portfolio project for senior fintech roles (RBC, TD, Wealthsimple, Koho) and a vehicle for learning payments/fintech deeply. Every design choice should be *defensible in an interview* — favour correctness and clear reasoning over cleverness.

## Source of truth

- **Requirements:** sharded PRD in `_bmad-output/prd/` (start at `index.md`). Full archived copy: `archive/PRD.md` (v1.1).
- **Architecture decisions & build roadmap (8 epics):** `~/.claude/plans/2-ai-recommended-techniques-twinkly-hennessy.md`
- **Design rationale:** `_bmad-output/brainstorming/brainstorming-session-2026-06-15-120816.md`

If a change contradicts the PRD shards, flag it rather than silently diverging.

## Repo structure (pnpm monorepo)

```
clarifi/
  apps/
    web/        # Next.js 15, React 19, TS — frontend + thin BFF route handlers
    api/        # Express + TS — REST API, BullMQ workers (outbox, anomaly, categorize)
  packages/
    shared/     # Zod schemas, shared types, Prisma client/schema
  pnpm-workspace.yaml
```

- Long-running work (BullMQ workers, outbox processor, async anomaly explanation) lives in `apps/api`, **never** in serverless route handlers.
- Shared domain types and Zod schemas live in `packages/shared` and are imported by both apps — do not duplicate types.

## Stack

- **Runtime:** Node 22.17.1 (`.nvmrc` → 22; `nvm use` before running tooling). Floor is ≥20.19 (Prisma 7 requirement).
- **Frontend:** Next.js 16 (Turbopack default), React 19, TypeScript, Tailwind 3, shadcn/ui, Recharts/Tremor, TanStack Query, Zustand, React Hook Form + Zod
- **Backend:** Node, Express, TypeScript, Prisma 7, PostgreSQL (Supabase), Redis + BullMQ (Upstash), OpenTelemetry
- **AI:** Claude API primary (use the latest model id — see the `claude-api` skill; do **not** answer model/pricing questions from memory), OpenAI fallback. Prompt templates kept separate from business logic; LLM output validated before use.

### Prisma 7 specifics (don't regress these)
- New `prisma-client` generator (Rust-free) outputs to `packages/shared/src/generated/prisma/` (gitignored). Import from `./generated/prisma/client.js`, **not** `@prisma/client`.
- Driver adapter required: `PrismaPg` against the pooled `DATABASE_URL` (see `packages/shared/src/prisma.ts`).
- Connection URLs live in `packages/shared/prisma.config.ts` (not the schema); migrations use the direct `DIRECT_URL`. `prisma generate` is manual (run after schema changes).

## NON-NEGOTIABLE guardrails (the 19 decisions)

These are settled. Do not reintroduce the anti-patterns they replace.

### Money & data model
- **Money is integer cents (`BIGINT`), never floats.** All arithmetic in integer cents; format to dollars only at the display layer. Field names end in `_cents`.
- **Amounts are signed from the user's perspective:** outflow negative, inflow positive. Normalize Plaid's inverted sign **once, at ingestion** (in the provider adapter) — the rest of the app never thinks about Plaid's convention.
- **Never SUM across currencies.** Aggregations are per-currency. CAD primary; USD broken out / labelled approx. No live FX in v1.
- **Transactions are mutable:** model `status` (pending/posted/removed) + `pending_transaction_id`. Upsert keyed on provider transaction id.
- **Idempotency:** unique constraint `(account_id, provider_transaction_id)`. At-least-once outbox + unique upsert = exactly-once effect.
- **Track category provenance:** `category_source` (llm/user/rule/merchant_cache) + `category_confidence` + `categorized_at`. A `user` override always wins and seeds the merchant cache.

### Multi-tenancy & query safety
- **Tenancy lives in Postgres Row-Level Security (RLS), never in application code or the LLM.** Per-request session var `app.current_user_id`; policies auto-filter. A WHERE-less query must still return only the user's rows.
- **NL queries use a semantic-layer IR, not raw NL→SQL.** LLM produces a constrained JSON query spec (metric/dimensions/filters/time range); deterministic code compiles it to **parameterized** SQL. The LLM never emits raw SQL.
- **Validate generated SQL with an AST allowlist** (SELECT-only, known tables/columns, whitelisted aggregates, single statement, mandatory LIMIT) on a **read-only DB role**. Allowlist, not keyword blocklist.
- NL query execution: `statement_timeout = 2s`. Always echo the interpretation back to the user.

### Anomaly detection
- **Detection (deterministic stats) is separate from explanation (LLM, async).** Detection runs sync on ingestion (<10ms, no LLM). The Plaid webhook ack is **never** blocked by LLM work. LLM down → templated explanation.
- **Robust statistics, not mean/std:** median + MAD, modified z-score `0.6745·(x−median)/MAD`, flag `>3.5`.
- **Cold-start:** hierarchical fallback (merchant → category → seeded global prior) + empirical-Bayes shrinkage by sample size.
- **Severity tiers** (info/warning/critical); only `critical` notifies. Optimize precision over recall.
- Dismiss/report **tune per-merchant sensitivity** (adaptive model), not just hide a row.

### FDX / open banking
- The FDX layer is an **anti-corruption layer** (provider-agnostic canonical model). Plaid/CSV/FDX are interchangeable adapters; the core never depends on a specific provider.
- The mock FDX simulates the **OAuth2 consent protocol** (Accounts/Transactions/Customer/Consent + grant/scope/revoke + consent dashboard), not just schema mapping.
- Terminology: **Consumer-Driven Banking** = Canada's framework (FCAC); **FDX** = the technical API standard it aligns to. ⚠️ Open item: verify Canada's designated standard as of 2026 before any public-facing claim.

### Privacy
- PIPEDA: explicit consent on signup; no PII logged; only anonymized (name/account stripped) transaction descriptions sent to LLM providers; account deletion must be honoured end-to-end.

## Conventions

- TypeScript strict everywhere. Validate all external input (API bodies, LLM output, webhook payloads) with Zod at the boundary.
- Match the style of surrounding code; keep comment density consistent with neighbours.
- Tests accompany business logic — especially the stats engine, money math, and the SQL AST validator (these are the high-risk, high-interview-value units).
- **Git commits:** do NOT add any Claude/AI attribution to commit messages — no `Co-Authored-By: Claude`, no "Generated with Claude Code" trailer, no mention of Claude or AI tooling. Write commit messages as the human author.

## Commands

Run `nvm use` first (Node 22). Then:

```
pnpm install                              # install workspace deps
pnpm --filter @clarifi/shared db:generate # generate Prisma client (manual in v7)
pnpm --filter @clarifi/web dev            # run frontend (Next 16)
pnpm --filter @clarifi/api dev            # run API + workers (tsx watch)
pnpm -r typecheck                         # typecheck all packages
pnpm -r test                              # run tests
pnpm --filter @clarifi/web build          # production build (Turbopack)
```

> Note: the API ships TS source from `@clarifi/shared` (fine under `tsx`/Next `transpilePackages`). A production build of `apps/api` will need bundling (tsup/esbuild) — deferred follow-up.

## Build order

Follow the 8-epic roadmap in the plan file. **Epic 1 first** (Foundation & Auth): monorepo scaffold, Prisma schema v1.1 with all data-model guardrails + RLS scaffolding, auth, CSV idempotent ingestion. The first migration must bake in integer-cents money, the idempotency constraint, and RLS — don't defer these.
