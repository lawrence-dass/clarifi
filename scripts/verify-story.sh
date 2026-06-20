#!/usr/bin/env bash
#
# verify-story.sh — the mandatory mechanical gate before a story may be marked
# "done" (especially in a mobile/cloud session). It FAILS LOUD on the exact gaps
# that let the Epics 5–8 cloud build ship broken/non-compliant code as "done":
#
#   1. DB-backed tests SKIPPED because no real DATABASE_URL  → "untested" looked green
#   2. @anthropic-ai/sdk imported OUTSIDE the gateway          → LLM-egress guardrail bypass
#   3. migrations not applied                                  → schema drift
#   4. typecheck / test failures
#
# This is trust-no-prose enforcement: if it doesn't exit 0, the story is NOT done.
# Run from anywhere; it cd's to the repo root.
#
# Usage:  pnpm verify:story        (or: bash scripts/verify-story.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf '\n❌ verify-story FAILED: %s\n' "$1" >&2; exit 1; }
step() { printf '\n▶ %s\n' "$1"; }

# Make DATABASE_URL/DIRECT_URL/secrets visible (vitest + prisma read root .env too).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# ── 1. A real database must be wired, or DB-backed tests silently skip ────────
step "Checking DATABASE_URL is a real database (not missing/placeholder)"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. DB-backed tests would skip (the Epic 5–8 failure mode). Provision a Postgres first — see _bmad/handoff/mobile-workflow.md § Environment bootstrap."
case "$DATABASE_URL" in
  *placeholder*) fail "DATABASE_URL is a placeholder — DB-backed tests would skip." ;;
esac

# ── 2. Single LLM egress point: the Anthropic SDK lives only in the gateway ───
step "Checking @anthropic-ai/sdk is imported only in lib/llm-gateway.ts"
OFFENDERS="$(grep -rln "@anthropic-ai/sdk" apps/api/src packages/shared/src 2>/dev/null \
  | grep -v "apps/api/src/lib/llm-gateway.ts" || true)"
[ -z "$OFFENDERS" ] || fail "@anthropic-ai/sdk imported outside the gateway (single-egress guardrail):
$OFFENDERS"

# ── 3. Migrations applied ────────────────────────────────────────────────────
step "Checking prisma migrate status"
if ! pnpm --filter @clarifi/shared exec prisma migrate status >/tmp/verify-migstatus.txt 2>&1; then
  cat /tmp/verify-migstatus.txt
  fail "migrations not fully applied (run: pnpm --filter @clarifi/shared db:migrate)."
fi

# ── 4. Typecheck every package ───────────────────────────────────────────────
step "Typecheck (pnpm -r typecheck)"
pnpm -r typecheck || fail "typecheck failed."

# ── 5. Full test suite, and ZERO skipped tests ───────────────────────────────
# A skipped test means describe.skipIf(!hasDb) fired → the DB isn't wired → the
# suite proves nothing. That is exactly how the Epic 5–8 bugs shipped, so any
# skip is a hard failure here.
step "Run full test suite (pnpm -r test) — zero skips allowed"
if ! pnpm -r test 2>&1 | tee /tmp/verify-tests.out; then
  fail "test suite failed."
fi
if grep -qiE "[1-9][0-9]* (skipped|todo)" /tmp/verify-tests.out; then
  grep -iE "[0-9]+ (skipped|todo)" /tmp/verify-tests.out >&2
  fail "tests were SKIPPED — DB-gated tests are not running (the Epic 5–8 failure mode). Wire a real DATABASE_URL and re-run."
fi

# ── 6. Guardrail tripwire (informational — agent must review) ─────────────────
step "Guardrail tripwire — files changed vs origin/main (review these)"
git diff --name-only origin/main...HEAD 2>/dev/null || true
cat <<'EOF'
  → If any touch: money/_cents · sign normalization · withUserContext/RLS ·
    (account_id, provider_transaction_id) · lib/llm-gateway|anonymize ·
    prisma/migrations · outbox/webhook/cursor · nl-query (read-only role + AST
    allowlist) → confirm full Tier-3 review was done before marking done.
EOF

printf '\n✅ verify-story PASSED — mechanical gate clear. (Tripwire review above is still your responsibility.)\n'
