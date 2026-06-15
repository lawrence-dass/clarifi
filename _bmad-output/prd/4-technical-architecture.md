# 4. Technical Architecture

## 4.1 System Overview

```
User Browser (Next.js)
        |
        v
   Vercel CDN
        |
        v
  Next.js App (frontend + API routes)
        |
   _____|_____
  |           |
  v           v
Node.js    Plaid API
Express    (sandbox)
Backend
  |
  |---- PostgreSQL (Supabase)
  |---- Redis (caching + job queue)
  |---- LLM API (Claude / OpenAI)
  |---- FDX Mock Layer
```

## 4.2 Frontend Stack
- Next.js 15, React 19, TypeScript
- Tailwind CSS, shadcn/ui
- Recharts or Tremor for financial charts
- TanStack Query for server state
- Zustand for client state
- React Hook Form + Zod for form validation

## 4.3 Backend Stack
- Node.js, Express.js, TypeScript
- Prisma ORM
- PostgreSQL (Supabase)
- Redis for caching and BullMQ job queue
- JWT authentication with refresh tokens
- OpenTelemetry for distributed tracing

## 4.4 AI Stack
- Claude API (primary) with OpenAI fallback
- LLM used for: transaction categorization, anomaly explanation, NL-to-SQL generation
- Prompt templates stored separately from business logic
- LLM responses validated before being shown to users

## 4.5 Key Backend Services

**TransactionService** — ingest, deduplicate (idempotent upsert on provider transaction id), store transactions; handles the pending → posted → removed lifecycle

**CategorizationService** — LLM categorization pipeline with retry and fallback; merchant→category cache; tracks `category_source`/confidence; LLM-as-judge validation

**AnomalyService** — robust-statistics detection engine (median/MAD modified z-score, hierarchical cold-start) plus a *separate, async* LLM explanation step; severity scoring and feedback-driven sensitivity tuning

**NLQueryService** — NL→IR (semantic layer) + IR→parameterized-SQL compiler, executed under RLS on a read-only role with an AST allowlist

**OutboxService** — reliable event processing for Plaid webhooks using the outbox pattern (at-least-once delivery + idempotent upsert = exactly-once effect)

**FDXAdapterService** — anti-corruption layer mapping any provider (Plaid, CSV, FDX) into Clarifi's provider-agnostic canonical model; also normalizes Plaid's sign convention at ingestion

## 4.6 Data Models (simplified)

**Money is stored as integer cents (`BIGINT`), never floats.** Floats can't represent decimal currency exactly and sums drift — disqualifying in a finance app. All arithmetic is done in integer cents; values are formatted to dollars only at the display layer. (`NUMERIC(19,4)` is the accepted alternative; FX/interest features may later warrant it.) Amounts are **signed from the user's perspective**: outflow negative, inflow positive. Plaid's inverted sign is normalized once, at ingestion.

**User** — id, email, password_hash, created_at

**Account** — id, user_id, provider, provider_account_id, institution_name, account_type, balance_cents, currency

**Transaction** — id, account_id, provider, provider_transaction_id, date, **amount_cents (signed BIGINT)**, **direction** (debit/credit, derived), currency, merchant_name, raw_description, category, **category_source** (llm/user/rule/merchant_cache), **category_confidence**, **categorized_at**, **status** (pending/posted/removed), **pending_transaction_id**, is_anomaly, created_at
- **Unique constraint:** `(account_id, provider_transaction_id)` — the idempotency key that makes outbox processing exactly-once in effect
- **RLS enabled** (filtered by `user_id` via the owning account)

**Budget** — id, user_id, category, monthly_limit_cents, month

**Anomaly** — id, transaction_id, type (velocity/merchant/amount), **severity** (info/warning/critical), explanation, dismissed, reported_suspicious, created_at

**Consent** — id, user_id, provider, scopes (granted data scopes), status (granted/revoked), granted_at, revoked_at — backs the FDX OAuth2 consent lifecycle and the consent dashboard

**Outbox** — id, event_type, payload, processed, created_at

## 4.7 FDX API Layer

The FDX layer is an **anti-corruption layer** (hexagonal / ports-and-adapters), not a re-normalizer. Clarifi's internal domain model is provider-agnostic; Plaid, CSV upload, and FDX are interchangeable **adapters** that map into one canonical model. The architectural value: Clarifi is not coupled to any single data provider — swapping Plaid for a real Consumer-Driven Banking connection means writing one new adapter, with zero changes to the core.

```
Plaid Adapter ┐
CSV Adapter   ├─→ [FDX Canonical Model]  ─→ Clarifi Domain ─→ Services
FDX Adapter   ┘     (anti-corruption layer)
```

**The mock FDX layer simulates the protocol, not just the schema.** Mapping field names proves little; the part that demonstrates real open-banking literacy — and the clearest contrast with Plaid — is the **consent lifecycle**. The mock exposes a credible slice of FDX:
- **Core resources:** `Accounts`, `Transactions`, `Customer`, and **`Consent`**
- **OAuth2 consent flow:** authorize → scoped grant → access token → **revocation**, surfaced through a **consent dashboard** ("you granted Clarifi read access to balances + transactions; revoke here")
- Correct FDX field semantics on transactions: accountId, transactionId, amount, currency (CAD), postedDate, description, merchantName, category

This contrasts with Plaid's item-based model and long-lived access token: FDX/Consumer-Driven Banking is **explicit, scoped, user-revocable consent** — which is what makes it *consumer-driven*. Full FDX conformance is intentionally out of scope; the goal is a credible, demonstrable slice.

---
