# Deferred Work

## Deferred from: story-12.1 verification (2026-06-21)

- **Concurrent-refresh test is timing-fragile against a fast (local) Postgres** — `auth.routes.test.ts > "is atomic under concurrent refresh of the same token (AC #3)"` (Story 1.3) passes against Supabase but fails **deterministically** against a low-latency local Postgres. The test fires two simultaneous `/auth/refresh` calls assuming their transactions overlap (so the conditional-revoke race path fires); on local PG the calls serialize, so the loser reads the winner's already-committed `revokedAt` and takes the family-revoke (reuse) branch, killing the winner's freshly-issued token → the follow-up rotation gets 401 instead of 200. Not introduced by 12.1 (the test file and `rotateRefreshToken`'s race logic are unchanged). Decide whether to (a) make the test timing-robust (e.g. force overlap / assert either valid outcome) or (b) re-examine the reuse-vs-race branch ordering in `rotateRefreshToken`. Pairs with the existing "Isolated test database" deferral. [apps/api/src/modules/auth/auth.routes.test.ts, apps/api/src/modules/auth/auth.service.ts rotateRefreshToken]

## Deferred from: code review of story-11.2 (2026-06-21)

- **Anomaly insights card shows a capped count** — the dashboard card derives its critical count from `useCriticalAnomalies` (`/anomalies?severity=critical&limit=10`), so with more than 10 criticals it under-reports the true total. Surfacing the real total needs a count returned by the anomalies endpoint (a new query the story deliberately avoided). Revisit when the API exposes a total. [apps/web/src/features/dashboard/anomaly-insights-section.tsx]

## Deferred from: code review of story-11.1 (2026-06-21)

- **Shared single-open-overlay state for header popovers** — the notification bell and the new user menu each render a full-viewport `fixed inset-0` dismiss layer, so switching directly from one open popover to the other costs an extra click. Low-severity UX; consistent with the existing bell idiom. Revisit by hoisting a single "which overlay is open" state into the shell. [apps/web/src/features/account/user-menu.tsx, apps/web/src/features/notifications/notification-bell.tsx]
- **Modal body-scroll lock** — `Modal` does not freeze background scroll while open (focus-trap was intentionally scoped out for v1). Add a small `overflow:hidden` on `<body>` while open when polishing a11y. [apps/web/src/components/ui/modal.tsx]

## Deferred from: code review of story-1.3 (2026-06-15)

- **Rate limiting / lockout on `/auth/login` + `/auth/refresh`** — credential stuffing, brute force, argon2 DoS. Extends the rate-limit middleware already deferred from Story 1.2. [apps/api/src/modules/auth/auth.routes.ts]
- **CSRF token + Origin/Referer check on cookie-auth POSTs** — SameSite=Strict covers cross-site CSRF for the same-site topology today; add a CSRF token when the web client lands (pairs with the SameSite cross-domain item). [apps/api/src/modules/auth]
- **Access-token revocation window** — logout / family-revoke / account-deletion don't cut an already-issued access JWT for up to its 15m TTL; `requireAuth` trusts `req.userId` without a user-existence check (a deleted user passes on future protected routes). Revisit with a `jti` denylist / shorter TTL / per-request user check — important for Story 1.6 (PIPEDA deletion). [apps/api/src/middleware/auth.ts]
- **Expired/revoked `refresh_tokens` cleanup job** — unbounded row growth + data-minimization smell; add a scheduled `DELETE WHERE expires_at < now() OR revoked_at IS NOT NULL`. [a sweeper / cron]
- **Session sprawl on re-login** — `/auth/login` doesn't revoke the prior family; no "revoke all sessions" hook (e.g. on password change). [apps/api/src/modules/auth/auth.service.ts loginUser]
- **Auth-hardening bundle** — SameSite cross-registrable-domain caveat (switch to lax/none + CSRF if web & API end up on different sites in prod); `secure` gated on NODE_ENV (ensure staging is HTTPS); add JWT `iss`/`aud`; log (don't swallow) unexpected argon2 verify errors. [apps/api/src/modules/auth/cookies.ts, tokens.ts, auth.service.ts]

## Deferred from: code review of story-1.2 (2026-06-15)

- **Rate limiting on auth routes** — `/auth/register` has no rate limit (email-enumeration amplifier + argon2 64 MiB DoS surface). Architecture plans `apps/api/src/middleware/rate-limit.ts`. Add it as a cross-cutting middleware (login Story 1.3 or Epic 8). [apps/api/src/modules/auth/auth.routes.ts]
- **Isolated test database** — integration tests load the root `.env` and run against the live Supabase instance (matches Story 1.1's `rls.test.ts`). Stand up a dedicated test DB (or schema) so tests never touch dev/prod data. Repo-wide infra. [apps/api/vitest.config.ts, packages/shared/vitest.config.ts]
- **`asyncHandler` wrapper** — every async Express handler currently hand-rolls try/catch + `next(err)`. Add a shared `asyncHandler` util before more routes land in Story 1.3. [apps/api/src/lib/]
- **DB error taxonomy** — only Prisma `P2002` is mapped (→409); transient pooler errors (P1017, connection lost) become 500 instead of a retryable 503. Build a small Prisma-error→HTTP mapper when more DB writes exist. [apps/api/src/modules/auth/auth.service.ts]

## Deferred from: code review of story-1.1 (2026-06-15)

- **Cross-account integrity: composite FK on transactions** — denormalized `transactions.user_id` + unscoped `account_id` FK lets a tenant insert a transaction with `user_id = me` but `account_id` referencing another tenant's account (RLS WITH CHECK only validates `user_id`). Deferred to preserve Story 1.1's "don't edit the schema" boundary; low real-world exploitability (RLS still hides the victim account on join). Fix = add `unique(accounts.id, user_id)` + composite FK `(account_id, user_id) → accounts(id, user_id)` on `transactions`. [packages/shared/prisma/schema.prisma]
- **No statement_timeout in `withUserContext`** — CLAUDE.md mandates `statement_timeout = 2s` for the NL-query path (Epic 6). The `withUserContext` helper sets role + GUC but no timeout. Add `SET LOCAL statement_timeout` when the NL-query path lands, or here. [packages/shared/src/prisma.ts]
- **Cross-tenant CASCADE-delete path untested** — `ON DELETE CASCADE` under FORCE RLS executes as the deleting role; the PIPEDA "deletion honoured end-to-end" guarantee can silently no-op if account deletion ever runs without a properly-scoped `app.current_user_id`. Safe by construction today (children share the parent's `user_id`). Add a within-tenant cascade test in Story 1.6 (account/data deletion). [0001_init FKs + 0002 FORCE RLS]
- **No boot-time env validation** — `.env.example` ships `change-me` JWT secrets and an empty `ENCRYPTION_KEY`; nothing rejects these at startup, and `prisma.config.ts` falls back to a placeholder URL. Add a Zod env schema that fails loud on placeholder/empty secrets in the auth stories (1.2/1.3). [.env.example, packages/shared/prisma.config.ts]
- **Test orphan-row leak + silent connection fallbacks** — interrupted RLS test runs leave orphaned `users`/`accounts`/`transactions` rows in the shared DB (new UUIDs each run, so no collision but accumulation); `createPrisma()` builds a client with an empty connection string when `DATABASE_URL` is unset, failing late with an opaque pg error. Minor hygiene/DX. [rls.test.ts, prisma.ts, prisma.config.ts]
