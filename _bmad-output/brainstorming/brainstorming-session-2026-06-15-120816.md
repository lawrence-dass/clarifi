---
stepsCompleted: [1, 2, 3]
inputDocuments: ['PRD.md']
session_topic: 'Clarifi — Canadian fintech app for intelligent transaction analysis, anomaly detection, and natural language financial querying'
session_goals: 'Refine the PRD with senior engineering perspective, explore latest technology choices, identify gaps and growth opportunities, prepare for PRD sharding and application build'
selected_approach: 'ai-recommended'
techniques_used: ['Question Storming', 'First Principles Thinking', 'Role Playing (planned, deferred)']
ideas_generated: ['19 architectural decisions across 4 clusters']
context_file: 'PRD.md'
---

# Brainstorming Session Results

**Facilitator:** Lawrence
**Date:** 2026-06-15

## Session Overview

**Topic:** Clarifi — a Canadian fintech personal finance intelligence app
**Goals:**
- Learn about payments and fintech deeply
- Build a strong portfolio project targeting Canadian fintech companies (RBC, TD, Wealthsimple, Koho)
- Understand from a senior engineer's perspective how to architect a modern solution with the latest technology
- Refine and sharpen the PRD, then shard it into buildable epics
- Prepare for application build

### Context Guidance

PRD v1.0 loaded. Refined to v1.1 through this session.

### Session Setup

Convergent-critical brainstorming (sharpen an existing strong PRD), not divergent ideation. Ran in plan mode; outcomes captured in PRD.md edits + plan file.

## Technique Selection

**Approach:** AI-Recommended Techniques
**Sequence:** Question Storming → First Principles Thinking → Role Playing
**Rationale:** Senior-engineer rigor = the questions asked + rebuilding from fundamentals. Role Playing deferred (user chose to consolidate after the four clusters were resolved).

## Phase 1 — Question Storming (output)

~35 hard questions generated across 11 domains (product scope, anomaly/ML, NL-to-SQL, FDX/open banking, Plaid/webhooks/outbox, security/PIPEDA, data model/money, LLM ops, operations, interview-defensibility). The questions exposed several genuine PRD bugs (money type unspecified, FDX-re-normalizing-Plaid circularity, missing idempotency, missing category_source).

## Phase 2 — First Principles (the 19 decisions)

### Cluster 1 — Data Model & Money
1. Money = integer cents (BIGINT), never float
2. Signed amounts (outflow negative), Plaid sign normalized at ingestion
3. Currency-aware; aggregations never mix currencies; live FX = v2
4. Add `category_source` + `category_confidence` + `categorized_at`
5. Mutable transaction lifecycle: `status` (pending/posted/removed) + `pending_transaction_id`
6. Idempotency: unique `(account_id, provider_transaction_id)` → exactly-once effect

### Cluster 2 — Anomaly Detection
7. Separate detection (deterministic stats, sync, <10ms) from explanation (LLM, async, non-blocking)
8. Robust statistics: median + MAD, modified z-score `0.6745·(x−median)/MAD`, flag >3.5
9. Cold-start: hierarchical fallback (merchant→category→global prior) + empirical-Bayes shrinkage
10. Severity tiers (info/warning/critical); only critical notifies; precision over recall
11. Context-aware rules (velocity scoped to same merchant; thresholds relative to user's typical size)
12. Feedback loop: dismiss/report tune per-merchant sensitivity → adaptive model

### Cluster 3 — NL-to-SQL
13. Tenancy via Postgres RLS, never the LLM
14. AST allowlist (not keyword blocklist) on a read-only role
15. Semantic-layer IR: LLM → JSON query spec → deterministic parameterized-SQL compiler
16. Transparency: echo interpretation + supporting rows + sanity bounds
17. Cost guards: statement_timeout 2s, mandatory LIMIT, NL→IR cache

### Cluster 4 — FDX & Open Banking
18. Terminology fix: Consumer-Driven Banking (framework, FCAC) vs FDX (technical API standard). Verify current standard as of June 2026.
19. FDX layer = anti-corruption layer (provider-agnostic); mock simulates the OAuth2 consent protocol (Accounts/Transactions/Customer/Consent + grant/revoke + dashboard), not just schema mapping

## Outcome

- PRD refined to **v1.1** (all 19 decisions applied across §1, §3.3, §3.5, §3.6, §4.5, §4.6, §4.7, §5, §8, §9)
- Sharding plan (8 epics) captured in plan file: `/Users/lawrence/.claude/plans/2-ai-recommended-techniques-twinkly-hennessy.md`
- Four scripted interview answers added to §9

## Action Items / Follow-ups

- Verify Canada's designated open-banking technical standard as of June 2026 before public claims
- Optional: run Phase 3 (Role Playing — skeptical interviewer / messy-finances user / 3am on-call) against v1.1
- Run BMAD shard-doc workflow on PRD.md to generate per-epic docs, then begin Epic 1
