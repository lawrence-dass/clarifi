# Core Architectural Decisions

## Decision Priority Analysis
**Critical (block implementation):** money representation, RLS tenancy, idempotency, auth + token storage, password hashing, Plaid token encryption.
**Important (shape architecture):** job queue, NL-query IR + validation, rate limiting, error contract, caching, observability.
**Deferred (post-MVP):** OpenAPI generation, Playwright e2e, live FX rates.

## Data Architecture
- PostgreSQL (Supabase) + Prisma 7 (`prisma-client` generator, PrismaPg adapter)
- Money: integer cents (BigInt), signed (user perspective); never float
- Multi-tenancy: Postgres RLS, denormalized userId, `withUserContext()` session var
- Idempotency: unique (account_id, provider_transaction_id) → exactly-once effect
- Migrations: Prisma migrate + a raw-SQL migration to ENABLE RLS and define policies
- Caching: Upstash Redis — merchant→category cache, NL→IR cache

## Authentication & Security
- Email + password; password hashing: argon2id (t=3, m=64MiB, p=1) — OWASP 2026
- JWT access + refresh-token rotation; httpOnly, Secure, SameSite cookies
- Authorization: Postgres RLS (DB-enforced), not application code
- Plaid access-token encryption at rest: AES-256-GCM envelope (Node crypto), key from secrets
- Rate limiting: Redis-backed, per-user + per-IP; stricter on /auth and /query
- LLM safety: AST allowlist + read-only role; anonymized descriptions to providers (PIPEDA)

## API & Communication Patterns
- REST over Express (TypeScript); Zod validation at every boundary
- Error contract: central middleware, JSON envelope { error: { code, message, details? } }
- NL queries: LLM → constrained IR (Zod) → parameterized SQL under RLS
- Docs: OpenAPI generated from Zod (deferred)
- web <-> api: REST + httpOnly cookies; api <-> worker: shared DB + BullMQ (Redis)

## Frontend Architecture
- Next.js 16 App Router (Turbopack), React 19, TypeScript
- Server state: TanStack Query 5.101; client state: Zustand
- Forms: React Hook Form + Zod; Charts: Recharts/Tremor; UI: Tailwind 3 + shadcn/ui

## Infrastructure & Deployment
- Hosting: Vercel (web) + Render (api + long-running worker tier)
- Job queue/workers: BullMQ 5.71 (native OpenTelemetry)
- Observability: OpenTelemetry tracing + targeted dashboards (categorization latency, anomaly precision, webhook lag)
- CI/CD: GitHub Actions — typecheck + test + build on PR
- Testing: Vitest (unit), Supertest (API), Playwright (e2e, later)
- Config: env-based; secrets in Vercel/Render; no secrets committed

## Decision Impact Analysis
**Implementation sequence:** schema + RLS migration -> auth (argon2 + JWT) -> ingestion (idempotent) -> categorization -> dashboard -> Plaid + outbox -> anomaly engine -> NL query -> FDX -> notifications/observability.
**Cross-component dependencies:** RLS underpins every data-touching feature; the shared Zod/Prisma package is imported by both apps; BullMQ underpins categorization, anomaly explanation, and outbox.
