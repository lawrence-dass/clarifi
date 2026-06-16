# Requirements Inventory

## Functional Requirements

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

## NonFunctional Requirements

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

## Additional Requirements

- Monorepo scaffold already realized (apps/web, apps/api, packages/shared); no starter-template story needed.
- Shared @clarifi/shared package houses Prisma 7 client + Zod schemas + domain types.
- Prisma migration: schema + a raw-SQL RLS-enable migration defining policies.
- Provider-agnostic anti-corruption layer (Plaid / CSV / FDX adapters).
- BullMQ worker tier: categorize, anomaly-explain, outbox-dispatch.
- LLM gateway abstraction (Claude primary, OpenAI fallback; use latest model id).
- GitHub Actions CI (typecheck / test / build on PR).

## UX Design Requirements

None (no UX design document; UI patterns covered in PRD/architecture).

## FR Coverage Map

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
