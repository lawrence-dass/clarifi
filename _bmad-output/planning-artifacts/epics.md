---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-06-15'
inputDocuments:
  - '_bmad-output/prd/ (sharded PRD v1.1, 10 sections + index)'
  - '_bmad-output/planning-artifacts/architecture.md (complete)'
---

# Clarifi - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Clarifi, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Users can sign up and sign in with email and password.
FR2: System issues JWT access tokens with refresh-token rotation, stored in httpOnly cookies.
FR3: Users explicitly consent to data processing at signup (PIPEDA).
FR4: Users can connect Canadian bank accounts via Plaid Link (sandbox).
FR5: System syncs transactions from Plaid via webhooks using cursor-based sync.
FR6: Users can upload CSV/PDF bank statements; system parses common Canadian bank formats.
FR7: System deduplicates transactions idempotently on re-upload and re-sync.
FR8: System normalizes provider data into a canonical model via an FDX-style adapter.
FR9: System auto-categorizes each transaction via LLM into the fixed category set.
FR10: System normalizes merchant names (e.g. "TIM HORTONS #1234" -> "Tim Hortons").
FR11: Users can override a transaction's category; system records provenance and learns via the merchant cache.
FR12: System validates LLM categorization output (LLM-as-judge).
FR13: Dashboard shows monthly spending breakdown by category.
FR14: Dashboard shows spending trend over time (last 6 months).
FR15: Dashboard shows top merchants by spend.
FR16: Dashboard shows income vs expenses summary and month-over-month comparison.
FR17: Users can set a monthly budget per category and track progress.
FR18: System detects velocity anomalies (repeated transactions at same merchant / short window).
FR19: System detects merchant anomalies (first-time merchant, large relative to the user's typical size).
FR20: System detects amount anomalies (above the user's robust baseline at that merchant).
FR21: System handles anomaly cold-start via hierarchical fallback + Bayesian shrinkage.
FR22: System assigns severity tiers; only critical triggers a notification.
FR23: Each anomaly gets an async plain-English LLM explanation with a templated fallback.
FR24: Users can dismiss or report anomalies; feedback tunes per-merchant sensitivity.
FR25: Users can ask natural-language questions about their financial data via chat.
FR26: System converts NL -> constrained IR -> parameterized SQL under RLS and returns an answer + chart + interpretation.
FR27: System enforces query safety: AST allowlist, read-only role, statement timeout, mandatory LIMIT.
FR28: Users receive in-app notifications for new anomalies.
FR29: Users can receive an optional weekly spending summary email digest.
FR30: Users receive budget alerts at 80% and 100% of a category's monthly budget.
FR31: Users can connect via FDX simulation (OAuth2 consent grant/scope/revoke) and view a consent dashboard.
FR32: Users can delete their account and all associated data (PIPEDA).

### NonFunctional Requirements

NFR1: Page load under 2 seconds.
NFR2: Dashboard API responses under 500ms.
NFR3: LLM categorization under 3 seconds per batch; cache hits bypass the LLM.
NFR4: Anomaly detection (stats) synchronous, under 10ms per transaction; LLM explanation async.
NFR5: Plaid webhook ack is never blocked by LLM work.
NFR6: NL query execution bounded by statement_timeout = 2s on a read-only role.
NFR7: Money stored as integer cents; aggregations never mix currencies.
NFR8: Multi-tenancy enforced via Postgres RLS (database-level).
NFR9: Passwords hashed with argon2id; JWT rotation; httpOnly/Secure/SameSite cookies.
NFR10: Plaid access tokens encrypted at rest (AES-256-GCM).
NFR11: Rate limiting per-user and per-IP, stricter on /auth and /query.
NFR12: PIPEDA: no PII logged; anonymized descriptions to LLM providers; end-to-end deletion.
NFR13: 99% uptime acceptable on free tiers.
NFR14: OpenTelemetry tracing across services + targeted dashboards.

### Additional Requirements

- Monorepo scaffold already realized (apps/web, apps/api, packages/shared); no starter-template story needed.
- Shared @clarifi/shared package houses Prisma 7 client + Zod schemas + domain types.
- Prisma migration: schema + a raw-SQL RLS-enable migration defining policies.
- Provider-agnostic anti-corruption layer (Plaid / CSV / FDX adapters).
- BullMQ worker tier: categorize, anomaly-explain, outbox-dispatch.
- LLM gateway abstraction (Claude primary, OpenAI fallback; use latest model id).
- GitHub Actions CI (typecheck / test / build on PR).

### UX Design Requirements

None (no UX design document; UI patterns covered in PRD/architecture).

### FR Coverage Map

FR1: Epic 1 - Email/password signup & signin
FR2: Epic 1 - JWT + refresh rotation in httpOnly cookies
FR3: Epic 1 - PIPEDA consent capture at signup
FR4: Epic 4 - Plaid Link account connection
FR5: Epic 4 - Webhook cursor-based transaction sync
FR6: Epic 1 - CSV/PDF statement upload & parsing
FR7: Epic 1 - Idempotent dedup (extended for Plaid in Epic 4)
FR8: Epic 1 - Canonical/anti-corruption adapter (CSV; extended Epic 4 Plaid, Epic 7 FDX)
FR9: Epic 2 - LLM auto-categorization
FR10: Epic 2 - Merchant-name normalization
FR11: Epic 2 - Category override + provenance + merchant-cache learning
FR12: Epic 2 - LLM-as-judge validation
FR13: Epic 3 - Monthly category breakdown
FR14: Epic 3 - 6-month spending trend
FR15: Epic 3 - Top merchants by spend
FR16: Epic 3 - Income vs expenses + month-over-month
FR17: Epic 3 - Per-category monthly budgets
FR18: Epic 5 - Velocity anomaly detection
FR19: Epic 5 - Merchant anomaly detection
FR20: Epic 5 - Amount anomaly detection
FR21: Epic 5 - Cold-start fallback + shrinkage
FR22: Epic 5 - Severity tiers
FR23: Epic 5 - Async plain-English explanations
FR24: Epic 5 - Dismiss/report tunes sensitivity
FR25: Epic 6 - Natural-language query chat
FR26: Epic 6 - NL->IR->SQL under RLS + answer/chart/interpretation
FR27: Epic 6 - Query safety (AST allowlist, read-only role, timeout, LIMIT)
FR28: Epic 8 - In-app anomaly notifications
FR29: Epic 8 - Weekly email digest
FR30: Epic 8 - Budget alerts at 80%/100%
FR31: Epic 7 - FDX consent flow + consent dashboard
FR32: Epic 1 - Account + all-data deletion

## Epic List

### Epic 1: Foundation & Auth
Users can securely sign up, sign in, and get their transactions into the system via CSV upload. Establishes the data model, Prisma migration, and RLS enablement (the security bedrock).
**FRs covered:** FR1, FR2, FR3, FR6, FR7, FR8, FR32

### Epic 2: Smart Categorization
Every transaction is automatically categorized and merchant-normalized, and users can correct it so the system learns.
**FRs covered:** FR9, FR10, FR11, FR12

### Epic 3: Spending Dashboard
Users see where their money goes: category breakdown, trends, top merchants, income vs expenses, and budgets.
**FRs covered:** FR13, FR14, FR15, FR16, FR17

### Epic 4: Plaid & Reliable Ingestion
Users connect real bank accounts (Plaid sandbox) with reliable, exactly-once webhook sync.
**FRs covered:** FR4, FR5

### Epic 5: Anomaly Detection
Users get early warning on unusual spending, explained in plain English, and can teach the system.
**FRs covered:** FR18, FR19, FR20, FR21, FR22, FR23, FR24

### Epic 6: Natural Language Query
Users ask questions about their finances in plain English and get safe, accurate answers.
**FRs covered:** FR25, FR26, FR27

### Epic 7: FDX & Open Banking
Users experience the Canadian open-banking consent model (grant/scope/revoke) via the FDX simulation.
**FRs covered:** FR31

### Epic 8: Notifications, Observability & Polish
Users stay informed (anomaly/budget alerts, weekly digest); the system is observable and production-credible.
**FRs covered:** FR28, FR29, FR30

## Epic 1: Foundation & Auth

Users can securely sign up, sign in, and load transactions via CSV. Establishes the persistence layer, RLS, and the canonical ingestion path.

### Story 1.1: Persistence foundation & RLS enablement

As a Clarifi user,
I want my data stored in a securely isolated database,
So that no other user can ever see my financial data.

**Acceptance Criteria:**

**Given** the Prisma 7 schema (User, Account, Transaction, Budget, Anomaly, Consent, Outbox)
**When** `prisma migrate` is run against Supabase
**Then** all tables are created with snake_case names, integer-cents money columns, and the unique (account_id, provider_transaction_id) constraint
**And** a raw-SQL migration enables ROW LEVEL SECURITY and adds per-table policies keyed on `app.current_user_id`
**And** a test proves a query inside `withUserContext(userA)` returns zero rows belonging to userB even with no WHERE clause.

### Story 1.2: User registration with email & PIPEDA consent

As a new user,
I want to register with email and password and consent to data processing,
So that I have a PIPEDA-compliant account.

**Acceptance Criteria:**

**Given** a registration request with email, password, and consent=true
**When** the request is validated by Zod and the password hashed with argon2id (t=3, m=64MiB, p=1)
**Then** a User row is created with `consented_at` set and only the password hash stored
**And** registration is rejected if consent is false, the email is already used, or the password fails policy.

### Story 1.3: User login with JWT and refresh rotation

As a registered user,
I want to log in and stay authenticated securely,
So that my session is protected.

**Acceptance Criteria:**

**Given** valid credentials
**When** I log in
**Then** an access token and a rotating refresh token are issued in httpOnly, Secure, SameSite cookies
**And** using a refresh token issues a new pair and invalidates the old refresh token (rotation)
**And** invalid credentials return a generic error without revealing which field was wrong.

### Story 1.4: CSV statement upload & canonical parsing

As a user,
I want to upload a bank CSV and have it parsed,
So that my transactions appear in Clarifi.

**Acceptance Criteria:**

**Given** a TD/RBC/Scotiabank CSV
**When** I upload it
**Then** rows are parsed into the canonical model via the CSV adapter, amounts stored as signed integer cents (outflow negative), currency captured
**And** the provider sign convention is normalized once at ingestion
**And** malformed rows are reported without aborting the whole import.

### Story 1.5: Idempotent ingestion & duplicate detection

As a user,
I want re-uploading the same statement to not create duplicates,
So that my data stays accurate.

**Acceptance Criteria:**

**Given** a statement already imported
**When** I upload it again
**Then** existing transactions are upserted on (account_id, provider_transaction_id) with no duplicates created
**And** genuinely new rows in the re-upload are added.

### Story 1.6: Account & data deletion (PIPEDA)

As a user,
I want to delete my account and all my data,
So that my PIPEDA right to erasure is honored.

**Acceptance Criteria:**

**Given** an authenticated user requesting deletion
**When** deletion is confirmed
**Then** all rows owned by the user (accounts, transactions, budgets, anomalies, consents) are removed via cascade
**And** the response confirms end-to-end deletion including a note on LLM-provider log handling.

## Epic 2: Smart Categorization

Transactions are auto-categorized and merchant-normalized; corrections teach the system.

### Story 2.1: LLM categorization pipeline

As a user,
I want my transactions automatically categorized,
So that I understand my spending without manual tagging.

**Acceptance Criteria:**

**Given** uncategorized transactions
**When** the categorization worker runs (via the LLM gateway, batched)
**Then** each transaction gets a category from the fixed set with `category_source=llm`, a confidence, and `categorized_at`
**And** only anonymized descriptions (no account holder name/number) are sent to the provider
**And** on LLM failure the job retries then falls back to `other` without blocking ingestion.

### Story 2.2: Merchant normalization & cache

As a user,
I want raw merchant strings cleaned up and reused,
So that my data is readable and categorization is cheap.

**Acceptance Criteria:**

**Given** a raw description like "TIM HORTONS #1234 VANCOUVER BC"
**When** it is normalized
**Then** `merchant_name` becomes "Tim Hortons"
**And** a normalized merchant already categorized hits the merchant cache (`category_source=merchant_cache`) instead of the LLM.

### Story 2.3: Category override & correction learning

As a user,
I want to correct a wrong category,
So that future similar transactions are right.

**Acceptance Criteria:**

**Given** a categorized transaction
**When** I override its category
**Then** the row updates with `category_source=user` and the override seeds the merchant cache
**And** subsequent transactions for that merchant use the user-confirmed category.

### Story 2.4: LLM-as-judge validation

As the system,
I want categorization output validated,
So that low-quality LLM results are caught.

**Acceptance Criteria:**

**Given** an LLM categorization result
**When** the judge check runs
**Then** results outside the allowed category set or below a confidence threshold are flagged for fallback/re-try
**And** judge disagreements are logged for review.

## Epic 3: Spending Dashboard

Users see where their money goes.

### Story 3.1: Monthly category breakdown

As a user,
I want a donut chart of spend by category for a month,
So that I see my biggest categories.

**Acceptance Criteria:**

**Given** categorized transactions for a month
**When** I open the dashboard
**Then** a per-currency category breakdown renders (no cross-currency summing)
**And** the API responds in under 500ms for a typical dataset.

### Story 3.2: Spending trend over time

As a user,
I want a 6-month spending trend line,
So that I see whether spending is rising.

**Acceptance Criteria:**

**Given** at least one month of data
**When** I view the trend
**Then** monthly totals for the last 6 months render per currency
**And** months with no data show zero, not gaps.

### Story 3.3: Top merchants, income vs expenses, month-over-month

As a user,
I want top merchants and an income/expense summary with MoM comparison,
So that I understand my cash flow.

**Acceptance Criteria:**

**Given** categorized, signed transactions
**When** I view the summary
**Then** top merchants by spend, total income vs expenses, and per-category month-over-month deltas are shown
**And** inflows (positive) and outflows (negative) are correctly separated.

### Story 3.4: Per-category budgets & progress

As a user,
I want to set a monthly budget per category and see progress,
So that I can control spending.

**Acceptance Criteria:**

**Given** a category
**When** I set a monthly limit (integer cents)
**Then** a Budget row is created for that category/month and progress is shown as spent/limit
**And** progress recomputes as new transactions arrive.

## Epic 4: Plaid & Reliable Ingestion

Users connect real bank accounts with reliable, exactly-once sync.

### Story 4.1: Plaid Link connection & token encryption

As a user,
I want to connect a bank via Plaid Link,
So that my transactions sync automatically.

**Acceptance Criteria:**

**Given** the Plaid sandbox
**When** I complete Plaid Link
**Then** an Account is created via the Plaid adapter (canonical model) and the access token is stored AES-256-GCM encrypted at rest
**And** the raw access token is never logged or returned to the client.

### Story 4.2: Webhook ingestion with outbox & cursor sync

As a user,
I want new transactions to arrive reliably,
So that nothing is lost or duplicated.

**Acceptance Criteria:**

**Given** a Plaid `SYNC_UPDATES_AVAILABLE` webhook
**When** it is received
**Then** the event is written to the outbox and the webhook is acked immediately (never blocked by LLM work)
**And** the outbox dispatcher calls `/transactions/sync` with the stored cursor and upserts idempotently (exactly-once effect)
**And** processing is retried safely on failure without duplicating transactions.

### Story 4.3: Transaction lifecycle (pending to posted to removed)

As a user,
I want pending charges to resolve correctly,
So that my data matches my bank.

**Acceptance Criteria:**

**Given** a pending transaction
**When** Plaid later posts or removes it
**Then** the row transitions status (pending->posted/removed) linking via pending_transaction_id
**And** removed transactions are excluded from dashboard math.

## Epic 5: Anomaly Detection

Users get early warning on unusual spending, explained plainly.

### Story 5.1: Robust-stats engine & baselines

As the system,
I want robust per-user baselines,
So that anomaly detection is accurate on heavy-tailed spending.

**Acceptance Criteria:**

**Given** a user's transaction history
**When** baselines are computed
**Then** median + MAD and a modified z-score (0.6745*(x-median)/MAD) are used (not mean/std)
**And** cold-start falls back merchant->category->global prior with sample-size shrinkage.

### Story 5.2: Velocity & merchant anomaly detection

As a user,
I want unusual transaction patterns flagged,
So that I catch problems early.

**Acceptance Criteria:**

**Given** a new transaction
**When** detection runs
**Then** repeated charges at the same merchant in a short window flag as velocity, and first-time merchants large relative to my typical size flag as merchant anomalies
**And** normal recurring patterns are not flagged.

### Story 5.3: Synchronous detection & severity scoring

As the system,
I want fast deterministic detection on ingestion,
So that flags are real-time without blocking webhooks.

**Acceptance Criteria:**

**Given** an ingested transaction
**When** detection runs synchronously
**Then** it completes in under 10ms with no LLM call and assigns severity info/warning/critical
**And** only critical severity triggers a notification.

### Story 5.4: Async plain-English explanations

As a user,
I want each anomaly explained in plain English,
So that I understand why it was flagged.

**Acceptance Criteria:**

**Given** a flagged anomaly
**When** the explanation worker runs
**Then** an LLM explanation is generated asynchronously and attached
**And** if the LLM is unavailable a templated explanation is shown instead.

### Story 5.5: Anomaly feed & feedback loop

As a user,
I want to dismiss or report anomalies,
So that the system adapts to me.

**Acceptance Criteria:**

**Given** a list of anomalies
**When** I dismiss or report one
**Then** the anomaly updates and the merchant's sensitivity threshold adjusts (dismiss raises, report lowers)
**And** future detection reflects the adjusted threshold.

## Epic 6: Natural Language Query

Users ask questions and get safe, accurate answers.

### Story 6.1: NL to IR generation

As a user,
I want my question turned into a structured query spec,
So that the system understands me without writing raw SQL.

**Acceptance Criteria:**

**Given** a natural-language question
**When** the LLM processes it
**Then** it returns a constrained IR (metric, dimensions, filters, time range, interpretation) validated by the Zod IR schema
**And** any IR failing validation is rejected before SQL is built.

### Story 6.2: IR to parameterized SQL with safety

As the system,
I want to compile the IR to safe SQL,
So that queries cannot leak data or run away.

**Acceptance Criteria:**

**Given** a valid IR
**When** it is compiled
**Then** parameterized SQL is generated and executed under `withUserContext` (RLS) on a read-only role with statement_timeout=2s and a mandatory LIMIT
**And** an AST allowlist rejects anything but SELECT over known tables/columns/aggregates
**And** even a WHERE-less query returns only the requesting user's rows.

### Story 6.3: Query chat UI with answer, chart, and interpretation

As a user,
I want answers with a chart and a plain restatement,
So that I trust the result.

**Acceptance Criteria:**

**Given** an executed query
**When** results return
**Then** the UI shows the numeric answer, a supporting chart, and "I interpreted this as ..."
**And** sanity-bound failures are surfaced rather than shown as a confident wrong number.

## Epic 7: FDX & Open Banking

Users experience the Canadian open-banking consent model.

### Story 7.1: FDX mock resources & adapter

As an interviewer/user,
I want Clarifi to expose FDX-shaped resources,
So that it demonstrates open-banking readiness.

**Acceptance Criteria:**

**Given** the FDX mock layer
**When** resources are requested
**Then** Accounts, Transactions, Customer, and Consent are returned in FDX-shaped schema mapped from the canonical model (anti-corruption layer)
**And** the core app remains provider-agnostic.

### Story 7.2: OAuth2 consent flow

As a user,
I want to grant and revoke scoped data access,
So that I control my data (consumer-driven).

**Acceptance Criteria:**

**Given** the FDX consent endpoint
**When** I authorize
**Then** a scoped consent grant + access token is issued and a Consent row recorded
**And** revoking sets status=revoked and blocks further FDX data access.

### Story 7.3: Consent dashboard

As a user,
I want to see and manage my granted consents,
So that I can revoke access anytime.

**Acceptance Criteria:**

**Given** active consents
**When** I open the consent dashboard
**Then** I see granted scopes and grant dates with a revoke action
**And** revoking updates the UI and the Consent row.

## Epic 8: Notifications, Observability & Polish

Users stay informed; the system is observable and production-credible.

### Story 8.1: In-app anomaly notifications

As a user,
I want to be notified of new critical anomalies,
So that I act quickly.

**Acceptance Criteria:**

**Given** a newly detected critical anomaly
**When** it is created
**Then** an in-app notification appears
**And** info/warning anomalies do not push but remain in the feed.

### Story 8.2: Budget alerts at 80% and 100%

As a user,
I want alerts as I approach a budget,
So that I avoid overspending.

**Acceptance Criteria:**

**Given** a category budget
**When** spend crosses 80% and 100% of the monthly limit
**Then** an alert fires once per threshold per month
**And** alerts reset at month rollover.

### Story 8.3: Weekly email digest

As a user,
I want an optional weekly spending summary email,
So that I stay aware without opening the app.

**Acceptance Criteria:**

**Given** a user opted into the digest
**When** the weekly job runs
**Then** a summary email is sent with the week's spend, top categories, and any anomalies
**And** opted-out users receive nothing.

### Story 8.4: Observability & CI

As an engineer,
I want tracing, dashboards, and CI,
So that the system is debuggable and changes are safe.

**Acceptance Criteria:**

**Given** the running services
**When** requests and jobs execute
**Then** OpenTelemetry traces span web/api/workers and dashboards cover categorization latency, anomaly precision, and webhook lag
**And** GitHub Actions runs typecheck + test + build on every PR.
