# 8. Phased Build Plan

## Phase 1 — Core (2 weeks)
- Auth (sign up, sign in, JWT + refresh rotation, PIPEDA consent capture)
- DB schema with integer-cents money, signed amounts, `category_source`, txn lifecycle, idempotency constraint, and RLS scaffolding
- CSV upload and transaction parsing (idempotent ingestion)
- LLM categorization with merchant cache + `category_source` tracking
- Basic spending dashboard (per-currency category breakdown, trends)

## Phase 2 — Plaid + Anomaly Detection (2 weeks)
- Plaid Link integration (sandbox); `SYNC_UPDATES_AVAILABLE` → `/transactions/sync` cursor handling
- Webhook ingestion with outbox pattern + idempotent upsert; pending → posted → removed lifecycle
- Anomaly detection engine: robust stats (median/MAD modified z-score), hierarchical cold-start, severity tiers, detect/explain split via BullMQ
- Anomaly feed with plain English explanations + feedback-tunes-sensitivity

## Phase 3 — NL Query + FDX (1-2 weeks)
- Natural language query interface
- NL→IR semantic layer + IR→parameterized-SQL compiler under RLS, AST allowlist, read-only role
- FDX anti-corruption adapter + mock FDX server (Accounts/Transactions/Customer/Consent) with OAuth2 consent flow + consent dashboard
- Budget tracking and alerts

## Phase 4 — Polish (1 week)
- OpenTelemetry tracing
- PIPEDA compliance audit
- README and architecture documentation
- Demo data seeded for interviews

---
