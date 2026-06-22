# 5. Non-Functional Requirements

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
| Demo bot-gate | Cloudflare Turnstile validated server-side before any LLM call (demo-mint + NL-query); no Google reCAPTCHA |
| Demo abuse limits | Per-IP rate limits (Redis/Upstash) on demo creation and LLM-backed requests; per-session quota of 10 NL queries |
| Demo lifetime | Demo users TTL-reaped 1 hour after creation, deleted end-to-end via the PIPEDA deletion path; no orphaned rows |
| Demo cost isolation | Demo controls never affect authenticated non-demo users |

---
