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

**Two hard rules (non-negotiable):**
1. **One story at a time.** Do not batch multiple stories or epics in a session. Build one
   story, run the full gate, merge or hand off, *then* consider the next. Batching is what
   let the Epics 5–8 cloud build mark 16 stories done at once with none actually verified.
2. **`pnpm verify:story` is the gate.** A story may be marked `done`/`review→done` and merged
   **only if `pnpm verify:story` exits 0.** It mechanically fails on the exact mistakes the
   cloud build made (skipped DB tests, SDK imported outside the gateway, unapplied
   migrations, typecheck/test failures). Prose alone was ignored before — this is enforced.

A mobile session is a **cold start**. Begin by loading context, **bootstrap the database**
(below — without it DB tests silently skip), then run the cycle end to end.

---

## Lessons from the Epics 5–8 cloud build (why this process exists)

A prior cloud session built Epics 5–8 and marked all of them `done`. A desktop verification
pass found real defects and guardrail violations that had shipped. Root causes — each now has
a mechanical or checklist guard:

- **DB tests were silently skipped.** The cloud had no real `DATABASE_URL`, so
  `describe.skipIf(!hasDb)` made DB-backed tests *skip*, and "skipped" looked green. Four real
  bugs shipped (an ESM `require()` in a test, a local-time date bug, an off-by-one velocity
  test, a Redis-hang). → **Guard:** bootstrap a real DB (below); `verify:story` fails on any
  skipped test.
- **A guardrail was bypassed silently.** `nl-query/ir-generator.ts` imported `@anthropic-ai/sdk`
  directly, bypassing the single-egress gateway (and its anonymization + fallback). → **Guard:**
  `verify:story` greps for SDK imports outside the gateway; the pre-flight checklist names it.
- **Guardrails met in spirit, not letter.** NL→SQL ran on the app role (not a read-only role)
  and used a regex keyword-blocklist (the guardrail says **AST allowlist, not blocklist**). →
  **Guard:** checklist rule — *when a guardrail says "X not Y", implement X exactly*.
- **Premature `done` across a big batch.** 16 stories closed at once with no independent
  DB-backed run. → **Guard:** one story at a time + the `verify:story` gate per story.

---

## Environment bootstrap (do this first — required)

DB-backed tests must actually run, not skip. Stand up a throwaway local Postgres in the
session (Redis is **not** needed — tests mock the queues):

```
# 1) Ephemeral Postgres (throwaway; no shared state, no real creds)
docker run -d --name clarifi-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# (if docker is unavailable, use any local postgres reachable on :5432)

# 2) Session env — the API also needs these two secrets to boot
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
export DIRECT_URL="postgresql://postgres:postgres@localhost:5432/postgres"
export JWT_ACCESS_SECRET="test-secret-at-least-32-characters-long-xx"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"   # 32 bytes

# 3) Install + generate client + apply ALL migrations (creates RLS roles too)
pnpm install
pnpm --filter @clarifi/shared db:generate
pnpm --filter @clarifi/shared db:migrate
```

Sanity check before coding: `pnpm verify:story` should run the full suite with **0 skipped**
tests. If anything is skipped, the DB isn't wired — fix that before doing anything else.

> **Isolation matters (story 10.4):** the suite asserts exact row counts, so it must run
> against a database **no worker is mutating**. Either don't run a worker against the test DB,
> or set **`TEST_DATABASE_URL`** (+ optional `TEST_DIRECT_URL`) to a throwaway local Postgres —
> `vitest.config.ts` redirects the suite there, so a worker on the dev/Supabase DB can't race
> the tests and make the gate flaky. Run migrations against that DB first.

---

## 0. Orient (cold start)

1. Read `CLAUDE.md` — the 19 guardrails, risk tiers, the guardrail tripwire, no-AI-attribution commits.
2. Run the `/session-start` equivalent: read `_bmad-output/CURRENT.md`,
   `_bmad-output/implementation-artifacts/sprint-status.yaml`,
   `_bmad-output/project-context.md`.
3. `nvm use` (Node 22). `git fetch origin`; confirm a clean tree on `main` (or note what's uncommitted).
4. **Bootstrap the database** (see § Environment bootstrap) and confirm `pnpm verify:story` runs
   with **0 skipped** tests. If DB tests skip, stop and fix the env — everything downstream is
   worthless otherwise.

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

## 4. Verify (the gate) — `pnpm verify:story` must exit 0

Run the mechanical gate. It is the single source of truth for "is this verifiable as done":

```
pnpm verify:story
```

It fails on: missing/placeholder `DATABASE_URL`; **any skipped test**; `@anthropic-ai/sdk`
imported outside `lib/llm-gateway.ts`; unapplied migrations; typecheck or test failures. Then
it prints the guardrail-tripwire file list for you to review.

Before relying on the gate, walk this **story-specific pre-flight checklist** (the gate can't
judge intent — you must):

- [ ] **Single LLM egress.** Any LLM call goes through `lib/llm-gateway.ts` (and its
      anonymizer). No `@anthropic-ai/sdk` / `new Anthropic(` anywhere else. (Gate-enforced too.)
- [ ] **Guardrail letter, not spirit.** When a guardrail says "**X, not Y**", implement X
      exactly — e.g. NL→SQL on a **read-only DB role** (`withReadOnlyUserContext`) and an
      **AST allowlist** validator (not a keyword blocklist). Don't ship a near-equivalent.
- [ ] **Queues are mocked in tests.** No test connects to a live Redis (`vi.mock` the queue,
      as `anomaly/persist.test.ts` does). A real-host hang ≠ a passing test.
- [ ] **Migrations applied & reviewed.** Any `prisma/migrations` change is applied
      (`db:migrate`) and is Tier-3 (RLS/roles/schema). Role-only changes still get scrutiny.
- [ ] **AC → test traceability.** Every AC maps to a named, *running* (not skipped) test;
      record the map in Completion Notes.
- [ ] **Tripwire reviewed.** For every file in the gate's tripwire list that touches a
      guardrail surface, confirm you applied full Tier-3 review.

Paste the actual `verify:story` summary (pass counts, 0 skipped) into Completion Notes —
evidence, not claims.

## 5. Merge decision — the "no red flags" gate

- **Clean and no red flags →** fast-forward the branch into `main`, flip the story (and the
  epic, if it's the last story) to `done` in `sprint-status.yaml`, and push `main` to origin.
- **Any red flag →** push the **branch** (not `main`), leave the story at `review`, write a
  clear handoff in `CURRENT.md` naming the red flag, and **stop for desktop verification**.
  Do not merge.

### Red flags (any one blocks an autonomous merge)

- **`pnpm verify:story` did not exit 0** — this alone blocks done/merge, no exceptions.
- typecheck fails, any test fails, or any test was **skipped** rather than run.
- the session touched **more than one story** (one story at a time — see the hard rules).
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

## Epic 9 (UI Redesign) — addendum for presentational web stories

Epic 9 restyles the web UI onto a shared design system. These stories are **web-only,
presentational, Tier 1** — they differ enough from the backend stories above that the
gate and guardrails apply differently. The full cycle (one story at a time, story file
to desktop standard, self-review on the three lenses, "no red flags" merge) is unchanged;
the deltas are:

**Design source of truth.** `docs/design-reference.md` (extracted from
`docs/screenshots/`) is the spec — palette, type scale, component catalogue, and a
screen-by-screen mapping. Read it before any Epic 9 story. The token + primitive
**foundation already exists (Story 9.1, done):**
- Tokens: `apps/web/src/app/globals.css` (CSS variables) + `apps/web/tailwind.config.ts`.
- Primitives: `apps/web/src/components/ui/*` — Button, Card (+`CardLabel`), Input,
  Skeleton (restyled) and Label, Badge, StatDelta, KpiTile, Progress, SegmentedBar (new).

**Reuse, don't reinvent.** Use the existing tokens and primitives. Do **not** introduce
colors outside the token set, a second button style, or new `slate-*` utilities — each
screen story *replaces* `slate-*` with tokens. If a primitive is missing, prefer adding
it to `components/ui/*` over a one-off.

**The one guardrail that still applies: money display discipline.** Even though these are
visual stories, the money rules hold — components do **no** monetary arithmetic (values
arrive pre-computed as integer cents and are formatted via the shared display formatter),
amounts are **per-currency and never combined**, and no PII is rendered. If a story pulls
you into `apps/api`, `packages/shared`, schema, or any data/query logic, it is **out of
scope** — stop and re-scope. The expected diff for an Epic 9 story is confined to
`apps/web/src/**` (a screen + maybe a primitive).

**Gate — use the web-only variant `pnpm verify:story:web`.** A presentational Epic 9
story touches zero backend code, so the full `verify:story` (which runs the DB-backed API
suite and hard-fails on any skip) would force you to stand up Postgres just to test
unrelated code. Instead use the no-database sibling:

```
pnpm verify:story:web
```

It (1) **refuses if the diff isn't web-only** — any file outside `apps/web/`/`docs/`/`_bmad`
makes it fail and tell you to run the full gate; (2) typechecks the web package;
(3) runs the web test suite with **zero skips allowed**; and (4) runs the
**Next/Tailwind production build** — the load-bearing check the full gate omits, where
token/utility-class mistakes surface. It must **exit 0** before done/merge; a failure is a
**red flag** exactly like a failed `verify:story`. Paste its summary into Completion Notes.

If a story turns out to touch `apps/api`, `packages/shared`, schema, or any data/query
logic, it is **not** web-only — `verify:story:web` will refuse, and you must bootstrap a
real DB and run the full `pnpm verify:story` instead (and the story is no longer Tier 1).

**Self-review emphasis (the three lenses, UI flavor).** Blind Hunter → no off-token colors,
no duplicated primitive, no stray `fetch`/format/loading pattern. Edge Case Hunter →
loading/error/empty states per section, narrow-viewport layout, over-budget (`percentUsed`
> 100 → clamp bar, show real value), a currency absent for the month, signed/zero deltas
(neutral affordance for zero — see Story 3.6's review finding). Acceptance Auditor → each
AC maps to a component test or a named gate (typecheck/test/**build**).

**Story order.** `9.2 app shell → 9.3 dashboard → 9.4 budgets → 9.5 auth → 9.6 NL-query
chat → 9.7 anomaly feed → 9.8 notifications → 9.9 consents → 9.10 account`. One at a time;
each builds on 9.2's shell.

---

## Commands quick reference

```
# one-time per session: stand up a real DB so tests don't skip
docker run -d --name clarifi-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
export DIRECT_URL="$DATABASE_URL"
export JWT_ACCESS_SECRET="test-secret-at-least-32-characters-long-xx"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"

nvm use                                          # Node 22
pnpm install
pnpm --filter @clarifi/shared db:generate        # after schema changes (manual in v7)
pnpm --filter @clarifi/shared db:migrate         # apply migrations (creates RLS roles)

pnpm verify:story                                # the gate — must exit 0 before done/merge
pnpm verify:story:web                            # Epic 9 web-only stories: no-DB gate (typecheck + web test + build)
```
