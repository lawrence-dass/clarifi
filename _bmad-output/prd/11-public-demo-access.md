# 11. Public Demo Access

A prospective reviewer can try the full app in **one click** — no email, no password, no real bank — while LLM/compute cost stays bounded and bot-resistant. A **"Try the live demo"** entry mints an **ephemeral, RLS-isolated demo user** pre-seeded with realistic data, automatically deleted after a short lifetime.

This directly serves the **secondary user named in §2** (fintech interviewers evaluating the portfolio project): zero-friction evaluation is the difference between an interviewer clicking through the real product and skimming a screenshot. It also lets the demo *showcase three of the project's pillars at once* — **RLS** tenancy (every demo visitor is invisible to every other), the **FDX anti-corruption layer** (Plaid Sandbox is just another adapter), and the **PIPEDA deletion path** (the TTL reaper *is* deletion).

> Scope note: the demo uses **Plaid Sandbox** (synthetic, free) and the existing sample CSV. **Real Plaid production access stays out of scope** (§10) — the demo respects that boundary rather than crossing it.

## 11.1 One-Click Ephemeral Demo Session

- A **"Try the live demo"** action on the landing and sign-in surfaces provisions a fresh **anonymous demo user** and drops the visitor straight into the authenticated app — no signup form, no credentials.
- The demo user is **RLS-isolated** through the standard `withUserContext` session-variable mechanism: a demo user's data is invisible to every other user, including other concurrent demo visitors. **No new tenancy path is introduced** — the demo is proof the existing isolation holds under anonymous, concurrent traffic.
- The user is **pre-seeded with realistic data through the canonical ingestion adapters** — **both** the existing sample CSV **and** Plaid **Sandbox** synthetic data (no Link UI, no real bank, no Plaid cost). Seeding both adapters is deliberate: it exercises the FDX anti-corruption story and the Plaid webhook/sync path in the same session.
- **Sign normalization is applied once at ingestion**, exactly as for real data — the demo never bypasses the sign-normalization boundary to "just seed rows."
- Seeded transactions are **pre-categorized at provision time**, so normal browsing of the demo incurs **no per-render LLM spend**.
- The demo user is **clearly marked as demo** (a flag/role on the user record, surfaced as a visible "Demo" badge in the UI) and can sign out / exit.
- The `(account_id, provider_transaction_id)` idempotency constraint and integer-cents money discipline hold for seeded data exactly as for real data.

## 11.2 Demo Abuse & Cost Controls

The whole point of a public demo is that anyone can reach it — which means bots can too. These controls keep automated traffic from running up the Claude/compute bill, **without affecting normal authenticated users**.

- **Privacy-friendly bot challenge.** A **Cloudflare Turnstile** challenge (no Google reCAPTCHA) gates the demo-mint action and the NL-query endpoint, **validated server-side before any LLM call**.
- **Per-IP rate limits.** The existing Redis/Upstash instance caps demo-user creation and LLM-backed requests per IP.
- **Per-session LLM quota.** Each demo session carries a quota of **10 NL queries** (the primary per-session LLM cost driver). Exceeding it returns a **clear, friendly limit message** rather than continuing to spend.
- **TTL reaper.** A demo user and **all** its data are removed **1 hour** after creation, end-to-end via the existing PIPEDA deletion path (Story 1.6) — no orphaned rows. The reaper *is* the deletion guarantee, re-used.
- **No blast radius on real users.** Rate-limit, quota, and reaping behaviour apply only to demo users; authenticated non-demo users are unaffected.

## 11.3 Demo Privacy Posture

The PRD's PIPEDA stance (§6) is built on *explicit consent at signup*. A one-click demo user has **no signup and no consent step** — and that is acceptable here for one specific reason: **a demo user holds synthetic data only.** The sample CSV and Plaid Sandbox data are not a real person's financial information, so there is no personal information to consent over. Combined with the 1-hour TTL reaper deleting everything end-to-end, the demo introduces **no new PII surface** and **no new retention obligation**.

## Functional Requirements (Epic 12)

Detailed acceptance criteria live in `planning-artifacts/epics/epic-12-public-demo-access.md`. Summary:

- **FR-12.1** — One-click provisioning of an anonymous, RLS-isolated demo user from a public "Try the live demo" entry, dropping the visitor into the authenticated app.
- **FR-12.2** — Demo users seeded via the canonical ingestion adapters (sample CSV + Plaid Sandbox), sign-normalized once at ingestion, pre-categorized at provision time, holding to the idempotency and integer-cents guardrails.
- **FR-12.3** — A visible "Demo" indicator and a demo flag/role on the user record; sign-out/exit supported.
- **FR-12.4** — Server-validated Turnstile bot challenge on demo-mint and NL-query, gating before any LLM call.
- **FR-12.5** — Per-IP rate limits (Redis/Upstash) on demo creation and LLM-backed requests.
- **FR-12.6** — Per-session quota of 10 NL queries with a friendly limit message on exceed.
- **FR-12.7** — TTL reaper deleting demo users and all their data 1 hour after creation, end-to-end via the existing PIPEDA deletion path; no orphaned rows; no impact on non-demo users.

---
