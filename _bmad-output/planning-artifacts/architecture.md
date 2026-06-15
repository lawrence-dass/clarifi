---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/prd/ (sharded PRD v1.1, 10 sections + index)'
  - 'CLAUDE.md (19 architecture guardrails)'
workflowType: 'architecture'
project_name: 'Clarifi'
user_name: 'Lawrence'
date: '2026-06-15'
lastStep: 8
status: 'complete'
completedAt: '2026-06-15'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (7 areas):**
- Authentication — email/password, JWT + refresh rotation, httpOnly cookies, PIPEDA consent
- Account Connection — Plaid (sandbox), CSV/PDF upload, FDX simulation; behind a provider-agnostic adapter
- Transaction Categorization — LLM pipeline with merchant cache, provenance tracking, correction learning
- Spending Dashboard — per-currency aggregations, trends, budgets
- Anomaly Detection — deterministic robust-stats engine + async LLM explanation
- Natural Language Query — NL→IR semantic layer → parameterized SQL under RLS
- Notifications — in-app anomaly alerts, budget alerts, weekly digest

**Non-Functional Requirements (architecture drivers):**
- Latency split: sync (dashboard <500ms, anomaly stats <10ms, NL query timeout 2s) vs async (categorization, explanation, outbox)
- Webhook ack must never block on LLM work → mandates a queue + worker tier
- Security: JWT rotation, httpOnly cookies, Postgres RLS for tenancy, AST-allowlist SQL on a read-only role, rate limiting, Plaid token encryption at rest
- Money: integer-cents storage; aggregations never cross currencies
- Privacy/Compliance: PIPEDA — no PII logged, anonymized descriptions to LLMs, end-to-end deletion
- Observability: OpenTelemetry tracing + targeted dashboards/alerts

**Scale & Complexity:**
- Primary domain: full-stack web (Next.js) + Node/Express API + async worker tier + AI/data pipeline
- Complexity level: medium-high
- Estimated architectural components: ~8 (web, API, worker, Postgres, Redis/queue, LLM gateway, Plaid adapter, FDX mock)

### Technical Constraints & Dependencies
- External: Plaid (sandbox), Anthropic/OpenAI, Supabase Postgres, Upstash Redis
- Hosting: Vercel (web) + Render (API/worker) — worker tier requires a long-running process (not serverless)
- Budget: $0–7/month; LLM cost controlled via merchant cache + IR cache

### Cross-Cutting Concerns Identified
- Multi-tenancy enforced via Postgres RLS (database-level, not application-level)
- Money correctness (integer cents) as a system-wide invariant
- Idempotency (exactly-once effect) on all transaction ingestion
- Asynchronous job processing (outbox + BullMQ) with graceful LLM degradation
- AI safety: LLM output always validated; no authority over tenancy or SQL
- Secrets management: Plaid access-token encryption at rest
- Observability and PIPEDA-compliant logging

## Starter Template Evaluation

### Primary Technology Domain
Full-stack web + async worker tier + AI/data pipeline.

### Starter Options Considered
- **create-next-app** — frontend only; doesn't address the worker tier or shared domain package.
- **T3 Stack** — opinionated Next.js + tRPC + Prisma, but single-app; fights the required web/API/worker separation and the Express + BullMQ worker tier.
- **Turborepo starter** — viable monorepo base, but adds Turbo's build orchestration we don't yet need.
- **Hand-rolled pnpm workspace** — selected.

### Selected Approach: Hand-rolled pnpm monorepo
**Rationale:** The architecture mandates a long-running worker tier (BullMQ, outbox, async anomaly explanation) that serverless/single-app starters don't accommodate. A hand-rolled pnpm workspace keeps the web/API/worker split explicit and the shared domain model (Prisma + Zod) in one package — matching the system design exactly, with no starter cruft to fight.

### Verified Stack (versions confirmed live, June 2026)
- **Runtime:** Node 22.17.1 (LTS; >=20.19 required by Prisma 7)
- **Web:** Next.js 16.2.9 (Turbopack default), React 19, Tailwind 3
- **API:** Express 4 + TypeScript, tsx (dev)
- **ORM:** Prisma 7.8.0 — new `prisma-client` generator (Rust-free), `PrismaPg` driver adapter, config-based datasource
- **DB/Cache:** PostgreSQL (Supabase), Redis + BullMQ (Upstash)
- **Validation:** Zod (shared schemas, incl. the NL-query IR)

### Structure
apps/web (Next.js) · apps/api (Express + workers) · packages/shared (Prisma 7 client, Zod, types)

**Note:** Project initialization is already complete (Epic 1 scaffold) — this documents the realized foundation rather than a future command.

## Core Architectural Decisions

### Decision Priority Analysis
**Critical (block implementation):** money representation, RLS tenancy, idempotency, auth + token storage, password hashing, Plaid token encryption.
**Important (shape architecture):** job queue, NL-query IR + validation, rate limiting, error contract, caching, observability.
**Deferred (post-MVP):** OpenAPI generation, Playwright e2e, live FX rates.

### Data Architecture
- PostgreSQL (Supabase) + Prisma 7 (`prisma-client` generator, PrismaPg adapter)
- Money: integer cents (BigInt), signed (user perspective); never float
- Multi-tenancy: Postgres RLS, denormalized userId, `withUserContext()` session var
- Idempotency: unique (account_id, provider_transaction_id) → exactly-once effect
- Migrations: Prisma migrate + a raw-SQL migration to ENABLE RLS and define policies
- Caching: Upstash Redis — merchant→category cache, NL→IR cache

### Authentication & Security
- Email + password; password hashing: argon2id (t=3, m=64MiB, p=1) — OWASP 2026
- JWT access + refresh-token rotation; httpOnly, Secure, SameSite cookies
- Authorization: Postgres RLS (DB-enforced), not application code
- Plaid access-token encryption at rest: AES-256-GCM envelope (Node crypto), key from secrets
- Rate limiting: Redis-backed, per-user + per-IP; stricter on /auth and /query
- LLM safety: AST allowlist + read-only role; anonymized descriptions to providers (PIPEDA)

### API & Communication Patterns
- REST over Express (TypeScript); Zod validation at every boundary
- Error contract: central middleware, JSON envelope { error: { code, message, details? } }
- NL queries: LLM → constrained IR (Zod) → parameterized SQL under RLS
- Docs: OpenAPI generated from Zod (deferred)
- web <-> api: REST + httpOnly cookies; api <-> worker: shared DB + BullMQ (Redis)

### Frontend Architecture
- Next.js 16 App Router (Turbopack), React 19, TypeScript
- Server state: TanStack Query 5.101; client state: Zustand
- Forms: React Hook Form + Zod; Charts: Recharts/Tremor; UI: Tailwind 3 + shadcn/ui

### Infrastructure & Deployment
- Hosting: Vercel (web) + Render (api + long-running worker tier)
- Job queue/workers: BullMQ 5.71 (native OpenTelemetry)
- Observability: OpenTelemetry tracing + targeted dashboards (categorization latency, anomaly precision, webhook lag)
- CI/CD: GitHub Actions — typecheck + test + build on PR
- Testing: Vitest (unit), Supertest (API), Playwright (e2e, later)
- Config: env-based; secrets in Vercel/Render; no secrets committed

### Decision Impact Analysis
**Implementation sequence:** schema + RLS migration -> auth (argon2 + JWT) -> ingestion (idempotent) -> categorization -> dashboard -> Plaid + outbox -> anomaly engine -> NL query -> FDX -> notifications/observability.
**Cross-component dependencies:** RLS underpins every data-touching feature; the shared Zod/Prisma package is imported by both apps; BullMQ underpins categorization, anomaly explanation, and outbox.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database (Postgres / Prisma):**
- Tables: snake_case, plural — `users`, `transactions`, `anomalies` (via `@@map`)
- Columns: snake_case in DB (`amount_cents`, `provider_transaction_id`) <-> camelCase in TS (via `@map`)
- PKs: `id` (uuid). Timestamps: `created_at` / `updated_at`. Money fields: always suffixed `_cents`
- Tenancy: every user-scoped table carries `user_id`

**API (REST):**
- Resource paths: plural nouns — `/transactions`, `/accounts`, `/anomalies`
- Path params: `:id`; query params and JSON bodies: camelCase
- Versioning: none for v1 (single client); revisit if needed

**Code (TypeScript):**
- Variables/functions: camelCase; types/interfaces/React components: PascalCase
- Files: kebab/lowercase for modules (`money.ts`, `nl-query-ir.ts`), PascalCase for components (`TransactionCard.tsx`)
- Services: `XxxService` (TransactionService, AnomalyService)

### Structure Patterns
- Tests co-located as `*.test.ts` next to source (Vitest)
- Frontend organized by feature, not by type
- Shared domain types/schemas/Prisma client live only in `packages/shared`
- API: route -> controller -> service -> (Prisma) repository layering

### Format Patterns
- Success: return the resource/data directly (no wrapper)
- Error: `{ error: { code, message, details? } }` via central middleware
- Dates: ISO-8601 strings in JSON; store as Postgres timestamptz
- JSON casing: camelCase everywhere (matches the Prisma TS layer)
- Money in JSON: integer cents (never floats); currency always accompanies an amount

### Communication Patterns
- BullMQ queue/job names: dot.case — `transactions.sync`, `categorize.transaction`, `anomaly.explain`, `outbox.dispatch`
- Outbox `event_type`: dot.case, past-tense — `transaction.ingested`
- Server state: TanStack Query; query keys are arrays — `['transactions', { filters }]`
- Client state: Zustand, one store per domain; immutable updates only

### Process Patterns
- Validation: Zod parse at every boundary (HTTP body, webhook payload, LLM output) — parse, don't validate
- Errors: throw a typed `AppError` (code + httpStatus); never leak internals to clients
- Logging: pino structured JSON; never log PII or raw account/transaction descriptions
- Loading/error UI: handled via TanStack Query states (isPending/isError), not ad-hoc flags

### Enforcement Guidelines
**All agents MUST:** store money as integer cents; route all user-data access through RLS (`withUserContext`); validate external input with Zod; import domain types from `@clarifi/shared`; never let the LLM emit raw SQL or enforce tenancy.
**Anti-patterns:** floats for money; `WHERE user_id = ...` in app code as the only tenancy guard; keyword-blocklist SQL filtering; duplicated type definitions across apps.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
clarifi/
├── package.json                 # workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .nvmrc                        # 22
├── .gitignore  .env.example  CLAUDE.md  README.md
├── .github/workflows/ci.yml      # typecheck + test + build on PR
├── apps/
│   ├── web/                      # Next.js 16 (App Router, Turbopack)
│   │   ├── next.config.mjs  tailwind.config.ts  postcss.config.mjs  tsconfig.json
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx  page.tsx  globals.css
│   │       │   ├── (auth)/sign-in/  (auth)/sign-up/
│   │       │   ├── dashboard/         # spending dashboard
│   │       │   ├── anomalies/         # anomaly feed
│   │       │   ├── query/             # NL chat interface
│   │       │   └── settings/consent/  # FDX consent dashboard
│   │       ├── components/{ui,features}/
│   │       ├── lib/{api-client,query-client,utils}.ts
│   │       └── stores/               # Zustand (one per domain)
│   └── api/                      # Express + workers
│       ├── tsconfig.json
│       └── src/
│           ├── server.ts  app.ts  config.ts
│           ├── modules/             # route -> controller -> service -> repository
│           │   ├── auth/  accounts/  transactions/  categorization/
│           │   ├── anomalies/  query/  fdx/  budgets/  notifications/  webhooks/
│           ├── middleware/{auth,error,rate-limit}.ts
│           ├── queues/              # BullMQ queue definitions
│           ├── workers/             # categorize, anomaly-explain, outbox-dispatch
│           ├── lib/{llm-gateway,crypto,plaid-adapter}.ts
│           └── observability/otel.ts
└── packages/
    └── shared/                  # @clarifi/shared
        ├── prisma.config.ts
        ├── prisma/{schema.prisma, migrations/}
        └── src/{index,prisma,money,nl-query-ir}.ts + generated/  (gitignored)
```

### Architectural Boundaries
- **API boundary:** web calls api over REST with httpOnly cookies; api is the only tier with DB credentials and provider secrets.
- **Tenancy boundary:** all user-data access flows through `withUserContext()` (RLS); the DB is the enforcement point.
- **AI boundary:** the LLM gateway (`lib/llm-gateway`) is the only egress to Claude/OpenAI; it sends anonymized data and its output is always Zod-validated. The LLM has no DB or SQL authority.
- **Sync/async boundary:** HTTP handlers do fast work + enqueue; `workers/` own all slow/LLM work via BullMQ. Webhook handlers ack immediately after enqueue.
- **Provider boundary:** `lib/plaid-adapter` + `modules/fdx` map external shapes into the canonical model (anti-corruption layer).

### Requirements -> Structure Mapping (by epic)
- Epic 1 Foundation & Auth -> `packages/shared/prisma`, `apps/api/src/modules/auth`, `apps/web/src/app/(auth)`
- Epic 2 Categorization -> `modules/categorization` + `workers/categorize` + Redis merchant cache
- Epic 3 Dashboard -> `apps/web/src/app/dashboard` + `modules/transactions` (per-currency aggregations)
- Epic 4 Plaid + Ingestion -> `modules/accounts`, `modules/webhooks`, `lib/plaid-adapter`, `workers/outbox-dispatch`
- Epic 5 Anomaly -> `modules/anomalies`, `workers/anomaly-explain`, stats engine in `lib/`
- Epic 6 NL Query -> `modules/query` (IR compiler + AST validator) + `apps/web/src/app/query`
- Epic 7 FDX -> `modules/fdx` (mock server + consent OAuth2) + `apps/web/src/app/settings/consent`
- Epic 8 Notifications/Observability -> `modules/notifications`, `observability/otel`, `.github/workflows`

### Data Flow
Ingestion: Plaid webhook -> `modules/webhooks` (verify, enqueue, ack) -> `workers` (sync via cursor, idempotent upsert) -> categorize + anomaly jobs -> DB. Read: web -> api (RLS query) -> JSON. NL query: web -> `modules/query` (LLM->IR->validated SQL under RLS) -> result + interpretation.

## Architecture Validation Results

### Coherence Validation
- **Decision compatibility:** Node 22.17.1 / Next 16.2.9 / React 19 / Prisma 7.8.0 / BullMQ 5.71 / TanStack Query 5.101 verified mutually compatible and confirmed building (typecheck + tests + web build + API smoke all green).
- **Pattern consistency:** naming/format/process patterns match the realized scaffold (Prisma `@map`, camelCase JSON, co-located tests, error envelope).
- **Structure alignment:** the monorepo split (web / api+workers / shared) supports the sync-vs-async boundary and the RLS tenancy boundary.

### Requirements Coverage Validation
- **Functional (7 areas):** each maps to a module/worker (auth, accounts+webhooks, categorization, transactions/dashboard, anomalies, query, fdx, notifications).
- **Non-functional:** latency split -> worker tier; tenancy -> RLS; money correctness -> integer cents; PIPEDA -> anonymized LLM egress + deletion; observability -> OTel.

### Implementation Readiness Validation
- Critical decisions documented with verified versions; patterns + structure complete and specific.

### Gap Analysis Results
- **Critical:** none.
- **Important (planned, tracked):** RLS-enable raw-SQL migration not yet written (lands in Epic 1); LLM model id intentionally not pinned (resolve via claude-api skill at build time, use latest).
- **Minor (deferred):** production bundling of apps/api (tsup/esbuild); OpenAPI generation; Playwright e2e; verify Canada's open-banking standard before public claims.

### Architecture Completeness Checklist
**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment
**Overall Status:** READY FOR IMPLEMENTATION (16/16 checklist items confirmed, no critical gaps)
**Confidence Level:** high
**Key Strengths:** DB-enforced tenancy (RLS); integer-cents money invariant; clean sync/async separation; AI bounded with no authority; verified current stack.
**Areas for Future Enhancement:** api production bundling, OpenAPI from Zod, e2e tests, live FX.

### Implementation Handoff
**AI agent guidelines:** follow CLAUDE.md guardrails + this document exactly; import domain types from `@clarifi/shared`; route all user-data access through `withUserContext()`.
**First implementation priority:** Epic 1 — Prisma migration (schema + RLS-enable raw SQL) and auth (argon2 + JWT rotation).
