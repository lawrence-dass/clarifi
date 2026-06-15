# Clarifi — Product Requirements Document

**Version:** 1.1
**Author:** Lawrence Dass
**Date:** June 2026

---

## 1. Product Overview

### What is Clarifi?

Clarifi turns your bank transactions into actionable insights. It automatically categorizes transactions, detects unusual spending patterns, and lets you query your own financial data in plain English.

Most banking apps show you a list of transactions. They don't tell you anything useful about them. Clarifi does three things they don't:

1. **Understands your spending** — automatically categorizes transactions and surfaces patterns over time
2. **Detects anomalies** — flags unusual transactions based on your personal spending history, not generic rules, and explains why in plain English
3. **Answers questions** — natural language interface to query your own financial data ("how much did I spend on food last month compared to the month before?")

### Primary User

Canadians who want clarity on where their money is going and early warning when something looks wrong.

### Why this exists

Canada is rolling out open banking under the federal **Consumer-Driven Banking** framework (the *Consumer-Driven Banking Act*, overseen by the Financial Consumer Agency of Canada / FCAC). That framework is the **regulatory layer**; the **Financial Data Exchange (FDX)** standard is the leading **technical API specification** it aligns to — REST resources, OAuth2 consent, JSON schemas. Clarifi is built with that future in mind: it supports both Plaid (available now) and a simulated FDX API layer, structured as a provider-agnostic adapter so a real Consumer-Driven Banking connection can be added without touching the core. This makes Clarifi compatible with where Canadian fintech is heading.

> Note: Canadian open banking is moving quickly. Verify FCAC's designated technical standard and the current rollout status before public-facing claims — this section reflects the landscape as understood at time of writing.

---

## 2. Target Users

**Primary:** Canadian individuals aged 25-45 who actively manage their finances and use multiple bank accounts or credit cards.

**Secondary:** Fintech interviewers at RBC, TD, Wealthsimple, Koho, and similar Canadian companies evaluating this as a portfolio project.

---

## 3. Core Features

### 3.1 Authentication
- Email and password sign up and sign in
- JWT access tokens with refresh token rotation
- Secure httpOnly cookies for token storage
- PIPEDA-compliant: no PII stored beyond what is necessary

### 3.2 Account Connection

**Option A — Plaid Integration**
- Connect Canadian bank accounts via Plaid Link (sandbox)
- Supports TD, RBC, Scotiabank, BMO, CIBC via Plaid sandbox
- Webhook-based transaction sync when new transactions arrive
- Outbox pattern for reliable webhook processing — no transaction lost if service fails mid-process

**Option B — CSV/PDF Upload**
- Upload a bank statement exported from any Canadian bank
- Parser handles common Canadian bank CSV formats (TD, RBC, Scotiabank)
- Duplicate detection on re-upload

**Option C — FDX API Simulation**
- Mock FDX (Financial Data Exchange) API layer that normalizes transaction data into the Canadian open banking standard
- Simulates what real open banking connections will look like when Canada's framework fully launches
- Sits between Plaid and the app, transforming Plaid data into FDX schema

### 3.3 Transaction Categorization
- LLM-powered automatic categorization on every transaction
- Categories: Food and Dining, Transport, Housing, Utilities, Shopping, Entertainment, Health, Travel, Income, Transfers, Other
- **Category provenance tracked** via `category_source` (`llm` | `user` | `rule` | `merchant_cache`) plus `category_confidence` and `categorized_at` — this is what makes the correction-learning loop and LLM-as-judge possible (you must be able to distinguish an LLM guess from a user override from a cached result)
- User can override any category and the system learns from corrections (a `user` override always wins and seeds the merchant cache)
- **Merchant→category memoization:** once "STARBUCKS #123" is categorized, repeat transactions hit the cache instead of the LLM — controls cost and latency
- Merchant normalization — "TIM HORTONS #1234 VANCOUVER BC" becomes "Tim Hortons"
- CAD currency handling throughout

### 3.4 Spending Dashboard
- Monthly spending breakdown by category (donut chart)
- Spending trend over time (line chart, last 6 months)
- Top merchants by spend
- Income vs expenses summary
- Month-over-month comparison per category
- Budget tracking — set a monthly budget per category, see progress

### 3.5 Anomaly Detection

**Architecture: detection and explanation are separate concerns.**
- **Detection** is deterministic statistics — runs synchronously on every ingested transaction (<10ms), no LLM in the path.
- **Explanation** is LLM-generated, runs **asynchronously** and never blocks transaction ingestion or the Plaid webhook ack. If the LLM is unavailable, a templated explanation is shown (graceful degradation).

**Statistical method (not naive mean/std).** Personal spending is heavy-tailed, so mean and standard deviation are distorted by the very outliers we want to catch. Detection uses **robust statistics**: median + **MAD** (Median Absolute Deviation) and a **modified z-score** `0.6745 · (x − median) / MAD`, flagging at `> 3.5` (Iglewicz–Hoaglin).

**Cold-start handling (hierarchical fallback + shrinkage).** On day 1, or for a merchant with only 1–2 transactions, there's no reliable personal baseline. Detection falls back: **merchant baseline → category baseline → seeded global priors**, blending the personal estimate toward the prior weighted by sample size (empirical-Bayes shrinkage). More history → more trust in the personal baseline.

Three types of anomalies detected:

**Velocity anomaly** — repeated transactions at the *same merchant / merchant-category* in a short window (e.g. 3 charges at one merchant in 10 minutes — a classic double-charge/fraud signal). Scoped this way to avoid flagging normal Saturday errands; recurring patterns are excluded.

**Merchant anomaly** — first-time transaction with a merchant where the amount is large **relative to the user's typical transaction size** (not a flat dollar threshold — $340 is normal for one user, alarming for another).

**Amount anomaly** — transaction significantly above the user's robust baseline at that merchant (or the fallback baseline during cold-start).

**Severity tiers, optimized for precision over recall.** Each detection is scored `info` | `warning` | `critical`. Only `critical` triggers a push notification; `info`/`warning` live quietly in the feed. A finance app that cries wolf gets deleted — precision matters more than recall.

Every flagged anomaly gets a plain English explanation:
> "This $847 charge at Best Buy is unusual. You have shopped there 3 times before with an average spend of $92. This charge is 9x your typical amount."

**Closed feedback loop.** User can mark anomalies as expected (dismiss) or report as suspicious — and these actions *tune sensitivity*: a dismissal raises that merchant's threshold ("this is normal for me"), a report lowers it. The result is an adaptive per-user model, not static rules.

### 3.6 Natural Language Query Interface
- Chat interface to query your own financial data
- Examples:
  - "How much did I spend on food last month?"
  - "Which month had my highest spending this year?"
  - "How much have I spent at Shoppers Drug Mart in the last 6 months?"
  - "What are my top 5 spending categories this quarter?"

**Design: semantic-layer / IR, not raw NL→SQL.** The LLM maps the question to a constrained **intermediate representation** — a small JSON query spec (metric, dimensions, filters, time range). Deterministic application code then compiles that IR into **parameterized SQL**. The LLM never writes raw SQL; it fills a validated, structured form. This gives natural-language flexibility while keeping full control over every byte of executed SQL (and prevents the "confidently wrong number" failure mode where a model sums the wrong column).

**Safety is defense-in-depth — the real risks are tenancy and wrong answers, not just injection:**
- **Multi-tenancy via Postgres Row-Level Security (RLS), never the LLM.** Authorization lives in the database: RLS policies + a per-request session variable (`app.current_user_id`) auto-filter every query. Even a `SELECT * FROM transactions` with no WHERE clause returns only the requesting user's rows. The AI layer is *incapable* of crossing a tenant boundary.
- **AST allowlist (not a keyword blocklist).** Generated SQL is parsed and rejected unless it matches an explicit allowlist: SELECT-only, known tables/columns, whitelisted aggregate functions, single statement, mandatory `LIMIT`. Executed on a **read-only DB role**, so mutation is physically impossible.
- **Transparency + validation.** The UI always shows how the question was interpreted ("I read that as: total spend, category = Food, May 2026"), echoes the supporting rows/chart so the answer is auditable, and applies result sanity bounds.
- **Cost/latency guards.** `statement_timeout = 2s` on the read-only role, compiler-injected `LIMIT`, and an NL→IR cache for repeat questions.

### 3.7 Notifications
- In-app notifications for new anomalies detected
- Weekly spending summary (optional email digest)
- Budget alert when a category reaches 80% and 100% of monthly budget

---

## 4. Technical Architecture

### 4.1 System Overview

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

### 4.2 Frontend Stack
- Next.js 15, React 19, TypeScript
- Tailwind CSS, shadcn/ui
- Recharts or Tremor for financial charts
- TanStack Query for server state
- Zustand for client state
- React Hook Form + Zod for form validation

### 4.3 Backend Stack
- Node.js, Express.js, TypeScript
- Prisma ORM
- PostgreSQL (Supabase)
- Redis for caching and BullMQ job queue
- JWT authentication with refresh tokens
- OpenTelemetry for distributed tracing

### 4.4 AI Stack
- Claude API (primary) with OpenAI fallback
- LLM used for: transaction categorization, anomaly explanation, NL-to-SQL generation
- Prompt templates stored separately from business logic
- LLM responses validated before being shown to users

### 4.5 Key Backend Services

**TransactionService** — ingest, deduplicate (idempotent upsert on provider transaction id), store transactions; handles the pending → posted → removed lifecycle

**CategorizationService** — LLM categorization pipeline with retry and fallback; merchant→category cache; tracks `category_source`/confidence; LLM-as-judge validation

**AnomalyService** — robust-statistics detection engine (median/MAD modified z-score, hierarchical cold-start) plus a *separate, async* LLM explanation step; severity scoring and feedback-driven sensitivity tuning

**NLQueryService** — NL→IR (semantic layer) + IR→parameterized-SQL compiler, executed under RLS on a read-only role with an AST allowlist

**OutboxService** — reliable event processing for Plaid webhooks using the outbox pattern (at-least-once delivery + idempotent upsert = exactly-once effect)

**FDXAdapterService** — anti-corruption layer mapping any provider (Plaid, CSV, FDX) into Clarifi's provider-agnostic canonical model; also normalizes Plaid's sign convention at ingestion

### 4.6 Data Models (simplified)

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

### 4.7 FDX API Layer

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

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Page load time | Under 2 seconds |
| API response time | Under 500ms for dashboard queries |
| LLM categorization | Under 3 seconds per batch (cache hits bypass the LLM entirely) |
| Anomaly detection (stats) | Synchronous, <10ms per transaction; LLM explanation is async |
| Webhook handling | Plaid webhook ack is never blocked by LLM work |
| NL query execution | `statement_timeout = 2s` on a read-only role |
| Uptime | 99% (Vercel + Render free tier acceptable for portfolio) |
| Data privacy | No PII logged, PIPEDA-compliant data handling |
| Money correctness | Integer-cents storage; aggregations never mix currencies |
| Security | JWT with rotation, httpOnly cookies, rate limiting, Postgres RLS for tenancy, AST-allowlist SQL validation, read-only query role |

---

## 6. PIPEDA Compliance Notes

- Users explicitly consent to data processing on sign up
- Transaction data is never shared with third parties beyond Plaid
- Users can delete their account and all associated data
- No sensitive financial data (account numbers, SINs) is stored
- All API calls to LLM providers use anonymized transaction descriptions — no account holder name or account number sent to LLM

---

## 7. Hosting and Infrastructure

| Service | Provider | Cost |
|---|---|---|
| Frontend | Vercel | Free |
| Backend | Render | Free tier ($7/month for always-on) |
| Database | Supabase | Free tier |
| Cache / Queue | Upstash Redis | Free tier |
| Plaid | Plaid Sandbox | Free |
| LLM | Claude / OpenAI | Pay per use, under $10/month for demo |
| Observability | OpenTelemetry + Render logs | Free |

**Total: $0-7/month**

---

## 8. Phased Build Plan

### Phase 1 — Core (2 weeks)
- Auth (sign up, sign in, JWT + refresh rotation, PIPEDA consent capture)
- DB schema with integer-cents money, signed amounts, `category_source`, txn lifecycle, idempotency constraint, and RLS scaffolding
- CSV upload and transaction parsing (idempotent ingestion)
- LLM categorization with merchant cache + `category_source` tracking
- Basic spending dashboard (per-currency category breakdown, trends)

### Phase 2 — Plaid + Anomaly Detection (2 weeks)
- Plaid Link integration (sandbox); `SYNC_UPDATES_AVAILABLE` → `/transactions/sync` cursor handling
- Webhook ingestion with outbox pattern + idempotent upsert; pending → posted → removed lifecycle
- Anomaly detection engine: robust stats (median/MAD modified z-score), hierarchical cold-start, severity tiers, detect/explain split via BullMQ
- Anomaly feed with plain English explanations + feedback-tunes-sensitivity

### Phase 3 — NL Query + FDX (1-2 weeks)
- Natural language query interface
- NL→IR semantic layer + IR→parameterized-SQL compiler under RLS, AST allowlist, read-only role
- FDX anti-corruption adapter + mock FDX server (Accounts/Transactions/Customer/Consent) with OAuth2 consent flow + consent dashboard
- Budget tracking and alerts

### Phase 4 — Polish (1 week)
- OpenTelemetry tracing
- PIPEDA compliance audit
- README and architecture documentation
- Demo data seeded for interviews

---

## 9. Interview Talking Points

**The story:**
> "I spent years at American Express manually analyzing spending patterns to detect fraud and retain customers. I wanted to see how much of that work could be automated with modern AI. Clarifi does in milliseconds what used to take my team hours — and it's built with Canadian open banking standards in mind."

**Technical depth points (with the scripted answers):**
- **Money correctness + exactly-once:** "I store money as integer cents, not floats, because float sums drift — fatal in finance. And at-least-once outbox delivery plus a unique upsert on the provider transaction id gives me exactly-once *effect* on ingestion."
- **Anomaly detection — why not ML:** "With no labeled fraud data and a hard requirement to explain every flag, I chose robust statistics — modified z-scores with hierarchical Bayesian fallback for cold-start — over a black box. The LLM only turns the statistical signal into plain English. Knowing when *not* to reach for ML is the judgment."
- **NL-to-SQL safety:** "The risk isn't injection, it's authorization and silent wrong answers. Tenancy lives in Postgres RLS so the model can't cross users; an AST allowlist on a read-only role validates generated SQL; a semantic-layer IR means the LLM fills a structured spec instead of writing raw SQL; and I echo my interpretation so a misread is visible, not silent."
- **FDX / open banking:** "My FDX layer is an anti-corruption layer making Clarifi provider-agnostic, and I simulated the OAuth2 consent grant/revocation flow — because consent, not the data schema, is what makes it *consumer-driven*. Plaid is item-based with a long-lived token; FDX is explicit, scoped, user-revocable consent."
- Outbox pattern for reliable Plaid webhook processing
- LLM-as-judge validation on categorization output
- PIPEDA-compliant — no PII sent to LLM providers
- OpenTelemetry distributed tracing across services

**Why Canadian fintech:**
- Supports Canadian banks via Plaid sandbox
- CAD currency throughout, stored as integer cents
- FDX — the technical API standard Canada's Consumer-Driven Banking framework aligns to (governance via FCAC)
- PIPEDA compliance built in from day one
- AFT awareness from BankStack09 background

---

## 10. Out of Scope (for now)
- Crypto integration
- Investment portfolio tracking
- Tax reporting
- Real Plaid production access (requires Plaid approval)
- Real FDX connections (not publicly available yet)
- Mobile app
