# Project Context Analysis

## Requirements Overview

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

## Technical Constraints & Dependencies
- External: Plaid (sandbox), Anthropic/OpenAI, Supabase Postgres, Upstash Redis
- Hosting: Vercel (web) + Render (API/worker) — worker tier requires a long-running process (not serverless)
- Budget: $0–7/month; LLM cost controlled via merchant cache + IR cache

## Cross-Cutting Concerns Identified
- Multi-tenancy enforced via Postgres RLS (database-level, not application-level)
- Money correctness (integer cents) as a system-wide invariant
- Idempotency (exactly-once effect) on all transaction ingestion
- Asynchronous job processing (outbox + BullMQ) with graceful LLM degradation
- AI safety: LLM output always validated; no authority over tenancy or SQL
- Secrets management: Plaid access-token encryption at rest
- Observability and PIPEDA-compliant logging
