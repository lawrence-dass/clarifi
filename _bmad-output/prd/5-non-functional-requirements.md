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

---
