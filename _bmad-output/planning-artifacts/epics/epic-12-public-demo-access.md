# Epic 12: Public Demo Access

Let an interviewer or reviewer try the full app in one click — no email/password,
no real bank — while keeping LLM/compute cost bounded and bot-resistant. A
**"Try the live demo"** entry mints an **ephemeral, RLS-isolated demo user**
pre-seeded with realistic data (the existing sample CSV plus Plaid **Sandbox**
synthetic data — free, via the sandbox flow in
https://plaid.com/docs/sandbox/#using-sandbox), TTL-reaped afterward. The demo
exercises and showcases three of the project's pillars at once: **RLS** tenancy,
the **FDX anti-corruption layer** (Plaid sandbox is just another adapter), and the
**PIPEDA deletion path** (the reaper *is* deletion).

> ⚠️ **Guardrail epic — Tier 3.** These stories touch RLS / `withUserContext`,
> the FDX/Plaid adapter, the LLM gateway (cost controls), and the deletion path.
> Every story here gets full guardrail review per CLAUDE.md's risk-tiered rules.
> Verify the exact Plaid Sandbox endpoints against the linked doc at build time;
> do not hardcode from memory. Demo provisioning must reuse `withUserContext` and
> the canonical ingestion adapters — never bypass RLS or the sign-normalization
> boundary to "just seed rows."

**FRs covered:** PRD §11 (Public Demo Access) — FR-12.1 through FR-12.7.
Formalized via the PRD addendum (2026-06-21): new shard `prd/11-public-demo-access.md`
plus reconciling edits to §2 (target users), §5 (NFRs), §6 (PIPEDA), §10 (out of scope).

## Story 12.1: One-click ephemeral demo session

As a prospective reviewer,
I want to enter a working Clarifi with realistic data without signing up or
connecting a real bank,
So that I can evaluate the product with zero friction.

**Acceptance Criteria:**

**Given** the landing/sign-in page
**When** I click **"Try the live demo"**
**Then** a fresh anonymous **demo user** is provisioned (RLS-isolated via the standard `withUserContext` session-var mechanism — a demo user's data is invisible to every other user, including other concurrent demo visitors) and I am dropped into the authenticated app
**And** the demo user is pre-seeded with realistic transactions sourced through the **canonical ingestion adapters** — the existing sample CSV and/or Plaid **Sandbox** synthetic data (`/sandbox/public_token/create` or equivalent per the linked doc; no Link UI required, no real bank, no Plaid cost) — with **sign normalization applied once at ingestion** exactly as for real data
**And** the seeded transactions are **pre-categorized** at provision time so normal browsing of the demo incurs **no per-render LLM spend**
**And** the demo user is clearly marked as demo (a flag/role on the user record) and visibly indicated in the UI (e.g. a "Demo" badge), and can sign out / exit
**And** the idempotency constraint `(account_id, provider_transaction_id)` and all money-as-integer-cents discipline hold for seeded data; typecheck and DB-backed tests pass.

## Story 12.2: Demo abuse & cost controls

As the operator of a portfolio project,
I want demo creation and the LLM-backed features rate-limited and bot-gated,
So that automated traffic can't run up my Claude/compute bill.

**Acceptance Criteria:**

**Given** the demo-mint endpoint and the LLM-backed endpoints (NL Query especially)
**When** the controls are in place
**Then** a privacy-friendly bot challenge (**Cloudflare Turnstile** or equivalent — no Google reCAPTCHA) gates the demo-mint action and the NL-query endpoint, validated server-side before any LLM call
**And** **per-IP rate limits** (using the existing Redis/Upstash) cap demo-user creation and LLM-backed requests
**And** each demo session carries a **per-session quota** on LLM-spending actions (e.g. a capped number of NL queries); exceeding it returns a clear, friendly limit message rather than continuing to spend
**And** a **TTL reaper** removes expired demo users and all their data end-to-end via the existing PIPEDA deletion path (no orphaned rows; deletion guarantees from Story 1.6 hold)
**And** none of these controls affect normal authenticated (non-demo) users; rate-limit and quota behaviour is covered by tests; typecheck passes.

## Story 12.3: Two demo flavors (CSV vs Plaid open-banking)

As a prospective reviewer,
I want to choose whether I'm trying the CSV-import demo or the Plaid open-banking demo,
So that each demo tells one clear story and isn't a muddled CAD/USD mix of both sources.

> Builds on 12.1 (provisioning) + 12.2 (mint controls). Refines, not replaces:
> the single "seed both" provisioning becomes **kind-branched** (one source each).

**Acceptance Criteria:**

**Given** the landing/sign-in surfaces
**When** the visitor chooses a demo
**Then** two entries are offered — **"Demo with sample CSV"** and **"Demo with Plaid (open banking)"** — and the choice is sent to the mint endpoint as a validated `kind` (`csv` | `plaid`)
**And** the demo user record records its **`demoKind`**, set at provision time
**And** provisioning **seeds only the source matching the kind** — the bundled CAD sample CSV for `csv`, or Plaid **Sandbox** for `plaid` — through the canonical adapters, sign-normalized once, pre-categorized, holding the idempotency + integer-cents guardrails (no cross-currency mixing within a demo)
**And** the UI badge reflects the kind — **"CSV Demo"** / **"Plaid Demo"** — and `demoKind` is surfaced to the client
**And** in the **CSV demo**, the "+ Add data" flow defaults to the **Generic CSV** format with the bundled sample available to import
**And** 12.2's Turnstile + per-IP rate limit + per-session quota + TTL reaper continue to apply unchanged to both kinds
**And** typecheck and DB-backed tests pass.

## Story 12.4: Fully-loaded demo (synchronous seeding)

As a prospective reviewer,
I want the demo dashboard fully populated the moment I land in it,
So that categories and anomalies are visible immediately, with no refresh.

> Polish follow-up to 12.1–12.3. The async categorize/detect path leaves a fresh
> demo briefly empty (the dashboard card fetches once on load, before the worker
> runs ~10-15s later). This blocks the mint until processing finishes.

**Acceptance Criteria:**

**Given** a demo mint (`POST /demo/session`, either kind)
**When** provisioning runs
**Then** categorization AND anomaly detection run **inline** (synchronously) before the 201 response, reusing the worker's `processCategorizeJob`
**And** the async categorize enqueue is **suppressed** for the demo path (CSV via a flag, Plaid via a no-op enqueue fn) so the worker never races the inline run and double-detects anomalies
**And** inline categorization is **best-effort** (`fallbackOnError`) — an LLM hiccup leaves the demo loadable rather than failing the mint
**And** non-demo ingestion is unchanged (still async); typecheck and DB-backed tests pass.
