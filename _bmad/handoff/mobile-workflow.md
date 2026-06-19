# Mobile Workflow — "from mobile"

How a **mobile/cloud Claude session** runs the full BMAD cycle solo, at the same
quality bar as the desktop Claude+Codex split, so code-review churn stays near-zero.

**When this applies:** the user says **"from mobile"** (see CLAUDE.md § Mobile sessions),
or work otherwise originates from a mobile/cloud session.

**Core principle.** On desktop, low review churn comes from *front-loading rigor*: a
richly-specced story (Pre-Review Due Diligence + AC→test traceability), a handoff that
bundles implement + self-review + fix, a guardrail tripwire, and an independent verify
gate. A mobile session has no second agent — so it must play **all** those roles itself,
in order, every time. Do not skip the front-loading; it is the reason desktop barely
finds bugs in review.

A mobile session is a **cold start**. Begin by loading context, then run the cycle
below end to end.

---

## 0. Orient (cold start)

1. Read `CLAUDE.md` — the 19 guardrails, risk tiers, the guardrail tripwire, no-AI-attribution commits.
2. Run the `/session-start` equivalent: read `_bmad-output/CURRENT.md`,
   `_bmad-output/implementation-artifacts/sprint-status.yaml`,
   `_bmad-output/project-context.md`.
3. `nvm use` (Node 22). `git fetch origin`; confirm a clean tree on `main` (or note what's uncommitted).

## 1. Create the story — `bmad-create-story`

Pick the next `ready-for-dev`/`backlog` story from `sprint-status.yaml` and its epic shard,
then create the story file **to desktop standard** (this front-loading is what kills churn):

- **Frontmatter:** `risk_tier` (classify by guardrails — escalate to Tier 3 if it touches
  any of the 19), `baseline_commit` (current `HEAD`), `context:` anchors (epic shard +
  directly-affected files).
- **Acceptance Criteria:** explicit and individually testable.
- **Tasks** mapped to ACs.
- **Dev Notes:** risk-tier rationale, the relevant architecture guardrails, previous-story
  intelligence (reuse/extend, don't duplicate), implementation guidance, testing standards.
- **Pre-Review Due Diligence** section that pre-empts the three review lenses (below), the
  guardrail tripwire, and AC→test traceability.

## 2. Implement — `bmad-dev-story`

- **Branch first:** `claude/<short-slug>` off latest `main`. Never code directly on `main`.
- Implement to the story; **reuse existing patterns** (extend functions, don't duplicate).
- One named test per AC; tests accompany business logic (stats, money math, AST validator,
  ingestion lifecycle).
- Validate all external input (API bodies, LLM output, webhook payloads) with Zod at the boundary.
- Honor the risk tier; escalate to Tier 3 the moment you touch a guardrail.

## 3. Self-review (the three lenses) — `bmad-code-review`

Before claiming done, run all three lenses on your **own** diff and fix every finding in the
same session:

- **Blind Hunter** — context-free correctness bugs.
- **Edge Case Hunter** — every boundary/branch. (4.3 is the cautionary tale: still-pending
  `modified` carrying a `pendingTransactionId`; same-page post + supersession for one id;
  unknown removed id; whole-page replay idempotency. Catch these here, not in a second commit.)
- **Acceptance Auditor** — every AC → a named, passing test; no AC left unproven.

Record the AC→test map and any findings in the story's **Completion Notes**.

## 4. Verify (the gate) — mobile runs all of this

Mobile has `DATABASE_URL`/Redis (root `.env`, loaded by `apps/api/vitest.config.ts`), so it
runs the real gate — not a code-reasoning approximation:

1. **Guardrail tripwire:** `git diff --name-only <baseline_commit>..HEAD`. If it touches
   money/`_cents`, sign normalization, `withUserContext`/RLS, the
   `(account_id, provider_transaction_id)` idempotency key, the LLM gateway/anonymizer,
   `prisma/migrations`, or outbox/webhook/cursor → apply full Tier-3 scrutiny.
2. `pnpm --filter @clarifi/api typecheck` (and `@clarifi/web` if touched).
3. Targeted DB-backed tests:
   `pnpm --filter @clarifi/api exec vitest run <files> --testTimeout=40000 --hookTimeout=40000`.
   **Confirm the DB tests actually ran** — if `hasDb` skipped them, `DATABASE_URL` isn't
   live and the run proves nothing (treat as a red flag).
4. Paste the **actual** typecheck + test output into Completion Notes. Evidence, not claims.

## 5. Merge decision — the "no red flags" gate

- **Clean and no red flags →** fast-forward the branch into `main`, flip the story (and the
  epic, if it's the last story) to `done` in `sprint-status.yaml`, and push `main` to origin.
- **Any red flag →** push the **branch** (not `main`), leave the story at `review`, write a
  clear handoff in `CURRENT.md` naming the red flag, and **stop for desktop verification**.
  Do not merge.

### Red flags (any one blocks an autonomous merge)

- typecheck fails, any test fails, or DB tests were **skipped** rather than passed.
- the guardrail tripwire surfaces a money/sign/RLS/idempotency/LLM-egress concern you are
  **not fully confident** is correct.
- a schema or migration change (`prisma/migrations`) — high blast radius; desktop verifies.
- the diff touches a guardrail surface the story **didn't scope** (unexpected guardrail diff).
- not a clean fast-forward to `main` (conflict, or `main` moved underneath you).
- a new runtime dependency was added.
- scope creep beyond the story, or you had to contradict the PRD/guardrails to proceed.
- an ambiguous requirement you resolved by guessing rather than by the spec.

## 6. Close out

- Update `sprint-status.yaml` and the story **Change Log**.
- Run `/session-end` so a desktop session can resume cleanly (`CURRENT.md` handoff).
- Commit messages are **human-authored** — no `Co-Authored-By: Claude`, no AI attribution
  (per CLAUDE.md).

---

## Commands quick reference

```
nvm use                                          # Node 22
pnpm install
pnpm --filter @clarifi/shared db:generate        # after schema changes (manual in v7)
pnpm --filter @clarifi/api typecheck
pnpm --filter @clarifi/api exec vitest run <files> --testTimeout=40000 --hookTimeout=40000
```
