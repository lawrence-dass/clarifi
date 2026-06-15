# 3. Core Features

## 3.1 Authentication
- Email and password sign up and sign in
- JWT access tokens with refresh token rotation
- Secure httpOnly cookies for token storage
- PIPEDA-compliant: no PII stored beyond what is necessary

## 3.2 Account Connection

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

## 3.3 Transaction Categorization
- LLM-powered automatic categorization on every transaction
- Categories: Food and Dining, Transport, Housing, Utilities, Shopping, Entertainment, Health, Travel, Income, Transfers, Other
- **Category provenance tracked** via `category_source` (`llm` | `user` | `rule` | `merchant_cache`) plus `category_confidence` and `categorized_at` — this is what makes the correction-learning loop and LLM-as-judge possible (you must be able to distinguish an LLM guess from a user override from a cached result)
- User can override any category and the system learns from corrections (a `user` override always wins and seeds the merchant cache)
- **Merchant→category memoization:** once "STARBUCKS #123" is categorized, repeat transactions hit the cache instead of the LLM — controls cost and latency
- Merchant normalization — "TIM HORTONS #1234 VANCOUVER BC" becomes "Tim Hortons"
- CAD currency handling throughout

## 3.4 Spending Dashboard
- Monthly spending breakdown by category (donut chart)
- Spending trend over time (line chart, last 6 months)
- Top merchants by spend
- Income vs expenses summary
- Month-over-month comparison per category
- Budget tracking — set a monthly budget per category, see progress

## 3.5 Anomaly Detection

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

## 3.6 Natural Language Query Interface
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

## 3.7 Notifications
- In-app notifications for new anomalies detected
- Weekly spending summary (optional email digest)
- Budget alert when a category reaches 80% and 100% of monthly budget

---
