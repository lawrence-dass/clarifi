# Implementation Patterns & Consistency Rules

## Naming Patterns

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

## Structure Patterns
- Tests co-located as `*.test.ts` next to source (Vitest)
- Frontend organized by feature, not by type
- Shared domain types/schemas/Prisma client live only in `packages/shared`
- API: route -> controller -> service -> (Prisma) repository layering

## Format Patterns
- Success: return the resource/data directly (no wrapper)
- Error: `{ error: { code, message, details? } }` via central middleware
- Dates: ISO-8601 strings in JSON; store as Postgres timestamptz
- JSON casing: camelCase everywhere (matches the Prisma TS layer)
- Money in JSON: integer cents (never floats); currency always accompanies an amount

## Communication Patterns
- BullMQ queue/job names: dot.case — `transactions.sync`, `categorize.transaction`, `anomaly.explain`, `outbox.dispatch`
- Outbox `event_type`: dot.case, past-tense — `transaction.ingested`
- Server state: TanStack Query; query keys are arrays — `['transactions', { filters }]`
- Client state: Zustand, one store per domain; immutable updates only

## Process Patterns
- Validation: Zod parse at every boundary (HTTP body, webhook payload, LLM output) — parse, don't validate
- Errors: throw a typed `AppError` (code + httpStatus); never leak internals to clients
- Logging: pino structured JSON; never log PII or raw account/transaction descriptions
- Loading/error UI: handled via TanStack Query states (isPending/isError), not ad-hoc flags

## Enforcement Guidelines
**All agents MUST:** store money as integer cents; route all user-data access through RLS (`withUserContext`); validate external input with Zod; import domain types from `@clarifi/shared`; never let the LLM emit raw SQL or enforce tenancy.
**Anti-patterns:** floats for money; `WHERE user_id = ...` in app code as the only tenancy guard; keyword-blocklist SQL filtering; duplicated type definitions across apps.
