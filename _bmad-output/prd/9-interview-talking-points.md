# 9. Interview Talking Points

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
