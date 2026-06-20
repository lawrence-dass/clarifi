#!/usr/bin/env bash
#
# verify-story-web.sh — the mechanical gate for **web-only, presentational**
# stories (Epic 9 UI Redesign: 9.2–9.10). It is the no-database sibling of
# scripts/verify-story.sh.
#
# Why a separate gate: the full `verify:story` runs `pnpm -r test`, which
# includes the DB-backed API suite and HARD-FAILS on any skipped test — so it
# needs a live Postgres. A UI restyle touches zero backend code, yet would still
# be blocked if the session can't stand up a database. This gate runs the checks
# that actually matter for a presentational web change, and adds the one the full
# gate omits: the Next/Tailwind production build (where token/utility-class
# mistakes surface).
#
# USE THIS ONLY when the diff is confined to apps/web/src/** (a screen + maybe a
# UI primitive). The moment a story touches apps/api, packages/shared, schema, or
# any data/query logic, it is NOT a web-only story — run the full `verify:story`
# (with a real DB) instead.
#
# Usage:  pnpm verify:story:web    (or: bash scripts/verify-story-web.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf '\n❌ verify-story-web FAILED: %s\n' "$1" >&2; exit 1; }
step() { printf '\n▶ %s\n' "$1"; }

# ── 1. Scope guard: this gate is only valid for a web-only diff ───────────────
# If the change reaches the backend/shared/schema, the web-only gate proves too
# little — refuse and point at the full gate.
step "Checking the diff is web-only (apps/web/** and docs/** only)"
CHANGED="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
if [ -n "$CHANGED" ]; then
  OUT_OF_SCOPE="$(printf '%s\n' "$CHANGED" \
    | grep -vE '^(apps/web/|docs/|_bmad)' || true)"
  if [ -n "$OUT_OF_SCOPE" ]; then
    printf '%s\n' "$OUT_OF_SCOPE" >&2
    fail "diff touches non-web files (above). This is not a web-only story — run the full \`pnpm verify:story\` against a real database instead."
  fi
fi

# ── 2. Typecheck the web package ──────────────────────────────────────────────
step "Typecheck (pnpm --filter @clarifi/web typecheck)"
pnpm --filter @clarifi/web typecheck || fail "web typecheck failed."

# ── 3. Web test suite, and ZERO skipped tests ────────────────────────────────
# Web tests are jsdom + mocked apiClient — they do not need a DB and must never
# skip. A skip here means a test silently didn't run.
step "Run web test suite (pnpm --filter @clarifi/web test) — zero skips allowed"
if ! pnpm --filter @clarifi/web test 2>&1 | tee /tmp/verify-web-tests.out; then
  fail "web test suite failed."
fi
if grep -qiE "[1-9][0-9]* (skipped|todo)" /tmp/verify-web-tests.out; then
  grep -iE "[0-9]+ (skipped|todo)" /tmp/verify-web-tests.out >&2
  fail "web tests were SKIPPED — investigate; a presentational story should run every test."
fi

# ── 4. Production build (Next/Tailwind) ──────────────────────────────────────
# The full verify:story does NOT build. Token/utility-class errors only fail
# here, so for UI stories this is the load-bearing check.
step "Production build (pnpm --filter @clarifi/web build)"
pnpm --filter @clarifi/web build || fail "web production build failed (often a bad/typo'd Tailwind class or token)."

# ── 5. Guardrail tripwire (informational — agent must review) ─────────────────
step "Guardrail tripwire — files changed vs origin/main (review these)"
printf '%s\n' "${CHANGED:-"(no committed changes vs origin/main)"}"
cat <<'EOF'
  → Money display discipline still applies on UI stories: components do NO
    monetary arithmetic (format pre-computed integer cents via the shared
    formatter), amounts are per-currency (never combined), no PII rendered.
    Confirm before marking done.
EOF

printf '\n✅ verify-story-web PASSED — web-only gate clear. (Tripwire review above is still your responsibility.)\n'
