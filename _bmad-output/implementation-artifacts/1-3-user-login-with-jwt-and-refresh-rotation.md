---
baseline_commit: aafaeeb
context:
  - _bmad-output/planning-artifacts/epics.md#Story 1.3
  - _bmad-output/planning-artifacts/architecture.md#Authentication & Security
  - CLAUDE.md
---

# Story 1.3: User login with JWT and refresh rotation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a registered user,
I want to log in and stay authenticated securely,
so that my session is protected.

## Acceptance Criteria

1. `POST /auth/login` with valid `{ email, password }` (validated by a shared Zod schema) verifies the password with `argon2.verify` against the stored hash and, on success, issues an **access token (JWT)** and a **rotating refresh token**, both set as **httpOnly, Secure (prod), SameSite cookies**. Response is `200` with the bare user resource `{ id, email, consentedAt }` — no token in the body, no `passwordHash`.
2. `POST /auth/refresh` reads the refresh cookie, validates it, and on success issues a **new** access+refresh pair (rotation) and **invalidates the old refresh token** so it can never be used again.
3. **Refresh-token reuse is detected:** presenting an already-rotated/revoked refresh token returns `401` and revokes the entire token family (theft response). Expired or unknown refresh tokens return `401`.
4. **Invalid credentials return a generic `401`** that does not reveal whether the email or the password was wrong, and login is **timing-safe** against user enumeration (a missing user still performs an argon2 verify against a dummy hash).
5. A protected route (`GET /auth/me`, behind a `requireAuth` middleware that verifies the access JWT) returns the current user for a valid access cookie and `401` without one. `POST /auth/logout` revokes the current refresh token and clears both cookies.
6. Tests cover: login success/failure (incl. identical generic error for wrong-email vs wrong-password), the rotation happy path, reuse detection, `requireAuth` accept/reject, and logout. Existing tests still pass; `pnpm -r typecheck` is clean.

## Tasks / Subtasks

- [x] Task 0: Persistence for refresh tokens (AC: #2, #3) — **schema change + migration**
  - [x] Add a `RefreshToken` model to `packages/shared/prisma/schema.prisma` (see Dev Notes for the exact shape): `id`, `userId` (denormalized for RLS), `tokenHash @unique`, `familyId`, `expiresAt`, `revokedAt?`, `createdAt`; relation to `User` `onDelete: Cascade`; `@@index([userId])`, `@@index([familyId])`; `@@map("refresh_tokens")`. Add `refreshTokens RefreshToken[]` to `User`.
  - [x] Generate the migration SQL with `pnpm --filter @clarifi/shared db:migrate:diff` → save as `prisma/migrations/0006_refresh_tokens/migration.sql`. Hand-append the RLS block (ENABLE + FORCE + `refresh_tokens_isolation` policy on `user_id`, mirroring `0002_enable_rls`) so the table is a normal user-scoped RLS table.
  - [x] `db:generate` then `db:deploy` (gated — applies to live Supabase).
- [x] Task 1: Shared login schema (AC: #1, #4) — `packages/shared/src/auth.ts`
  - [x] Add `LoginInput` Zod schema: `email` (trim/lowercase/email/max 254, reuse the `RegisterInput` email shape) + `password` (`z.string().min(1)` — do NOT re-apply the 12–128 policy; login must accept any stored password and reveal nothing). Export the type.
  - [x] Unit test `auth.test.ts`: accepts a valid body; rejects missing email/password.
- [x] Task 2: Token helpers (AC: #1, #2, #3, #5) — `apps/api/src/modules/auth/tokens.ts`
  - [x] `issueAccessToken(userId)`: sign a JWT with `jose` (HS256, secret from config, `sub=userId`, TTL = `ACCESS_TOKEN_TTL`). `verifyAccessToken(jwt)`: `jwtVerify` → returns `userId` or throws.
  - [x] `generateRefreshToken()`: `crypto.randomBytes(32).toString("base64url")` (opaque, high-entropy). `hashToken(raw)`: `crypto.createHash("sha256").update(raw).digest("hex")` — only the hash is stored.
  - [x] Unit test `tokens.test.ts` (no DB): issued JWT verifies and round-trips `userId`; a tampered/expired token fails; `hashToken` is deterministic and differs from input.
- [x] Task 3: Auth service — login / rotate / revoke (AC: #1–#5) — `apps/api/src/modules/auth/auth.service.ts`
  - [x] `loginUser({email,password})`: look up user by email (base `prisma`); if absent, run `argon2.verify(DUMMY_HASH, password)` to equalize timing, then throw `unauthorized("INVALID_CREDENTIALS", ...)`; if present, `argon2.verify(user.passwordHash, password)` → on false throw the **same** generic error. On success: create a refresh-token row (new `familyId`), return `{ user, accessToken, refreshToken }`.
  - [x] `rotateRefreshToken(rawToken)`: hash, look up row. If not found/expired → `unauthorized`. If `revokedAt` set → **reuse**: revoke the whole `familyId` (`updateMany`), then `unauthorized("TOKEN_REUSE", ...)`. Else: set `revokedAt` on the current row and create a new row in the same family; issue a new access token; return the new pair + user.
  - [x] `revokeRefreshToken(rawToken)`: mark the row revoked (idempotent — no error if already gone). Used by logout.
  - [x] Add `unauthorized(code, message)` (401) helper to `apps/api/src/lib/app-error.ts`.
  - [x] These flows use the **base `prisma` client, not `withUserContext`** — they run pre-auth (no user context yet); lookups are by the unique high-entropy `token_hash`. Document this (same sanctioned exception as registration).
- [x] Task 4: requireAuth middleware (AC: #5) — `apps/api/src/middleware/auth.ts`
  - [x] Read the access cookie (`cookie-parser` already mounted), `verifyAccessToken`, set `req.userId`. Missing/invalid → `unauthorized`. Add a typed `userId?: string` augmentation for Express `Request` in a local `types.d.ts` or via module augmentation.
- [x] Task 5: Controller + routes + cookies (AC: #1–#5) — `apps/api/src/modules/auth/`
  - [x] Cookie helpers `setAuthCookies(res, {accessToken, refreshToken})` and `clearAuthCookies(res)`: `httpOnly: true`, `secure: config.NODE_ENV === "production"`, `sameSite: "strict"`; access cookie `path: "/"`, refresh cookie `path: "/auth"` (only sent to auth routes), `maxAge` from the TTLs.
  - [x] `auth.controller.ts`: `login` (parse `LoginInput` → service → set cookies → 200 user), `refresh` (read cookie → rotate → set cookies → 200 user), `logout` (read cookie → revoke → clear cookies → 204), `me` (return user for `req.userId`).
  - [x] `auth.routes.ts`: `POST /login`, `POST /refresh`, `POST /logout`, `GET /me` (me behind `requireAuth`).
- [x] Task 6: Config + deps + verify (AC: #6)
  - [x] `apps/api/src/config.ts`: make `JWT_ACCESS_SECRET` **required** (`z.string().min(32)`); add `ACCESS_TOKEN_TTL` (default `"15m"`) and `REFRESH_TOKEN_TTL` (default `"7d"`). `JWT_REFRESH_SECRET` is unused under the opaque-refresh design — leave it optional and note it. Ensure tests provide a `JWT_ACCESS_SECRET` (it's in `.env`; confirm or add to the vitest env load).
  - [x] Add `jose` to `apps/api` deps (gated install).
  - [x] `auth.routes.test.ts` (supertest, DB-gated): extend with login/refresh/logout/me flows + the reuse-detection case. Assert cookies are `HttpOnly`; assert wrong-email and wrong-password yield byte-identical error bodies.
  - [x] `pnpm -r typecheck` + `pnpm -r test` green.

### Review Findings

_Adversarial code review 2026-06-15 (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — run on Opus 4.8, same model as implementer (independent-model pass not used). All 6 ACs MET in code. 4 patch, 6 deferred, 4 dismissed. Two layers independently caught the rotation race (the headline issue)._

**Patch (all applied):**

- [x] [Review][Patch] **Refresh rotation is not atomic → reuse-detection bypass (High).** APPLIED: `rotateRefreshToken` now wraps the revoke+issue in `prisma.$transaction` and uses a **conditional** `updateMany({ where: { id, revokedAt: null } })` as the race guard — concurrent rotations of the same token serialize on the row lock, exactly one gets `count === 1`, the loser is treated as reuse (revoke family). Family revocation runs outside the tx so it persists when we throw. Proven by a new `Promise.all` concurrency test (exactly one 200 + one 401). Note: this fully closes the double-issue race (EC1/BH1); the narrower sweep-vs-insert interleave (EC2) is substantially mitigated by the transaction — a SERIALIZABLE-isolation hardening is noted as future work. [apps/api/src/modules/auth/auth.service.ts]
- [x] [Review][Patch] **Two TTL parsers disagreed (High).** APPLIED: the JWT `exp` is now derived from `durationToSeconds` (single source of truth for JWT exp + cookie maxAge + DB expiry); `durationToSeconds` rejects `0`/leading-zeros; `config.ts` validates `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL` against the exact grammar at boot. [apps/api/src/modules/auth/tokens.ts, apps/api/src/config.ts]
- [x] [Review][Patch] **Test depth on the security-critical paths (Med).** APPLIED: added a concurrent-refresh test (exactly one wins), changed the rotation test to replay the OLD token and assert 401, and added a cookie-attribute test (`SameSite=Strict` on both, refresh `Path=/auth`). api suite now 28 tests. [apps/api/src/modules/auth/auth.routes.test.ts]
- [x] [Review][Patch] **Dead/misleading `JWT_REFRESH_SECRET` config (Low).** APPLIED: removed from the `config.ts` schema (refresh tokens are opaque, not JWTs). [apps/api/src/config.ts]

**Deferred:**

- [x] [Review][Defer] Rate limiting / lockout on `/auth/login` + `/auth/refresh` (credential stuffing, brute force, argon2 DoS) [apps/api/src/modules/auth/auth.routes.ts] — deferred: extends the rate-limit middleware already deferred from Story 1.2; cross-cutting.
- [x] [Review][Defer] CSRF token + Origin/Referer check on cookie-auth state-changing POSTs (login-CSRF / session fixation) [apps/api/src/modules/auth] — deferred: SameSite=Strict covers cross-site CSRF for the same-site topology today; add a CSRF token when the web client lands. Pairs with the SameSite cross-domain item below.
- [x] [Review][Defer] Access-token revocation window — logout / family-revoke / account-deletion don't cut an already-issued access JWT for up to its 15m TTL; `requireAuth` trusts `req.userId` without a user-existence check, so a deleted user passes on future protected routes [middleware/auth.ts, tokens.ts] — deferred: accepted stateless-JWT tradeoff for now; revisit with a `jti` denylist / shorter TTL / per-request user check, especially for Story 1.6 (PIPEDA deletion).
- [x] [Review][Defer] No cleanup of expired/revoked `refresh_tokens` rows (unbounded growth; data-minimization smell) [migration / a sweeper job] — deferred: add a scheduled `DELETE WHERE expires_at < now()` (or revoked) job.
- [x] [Review][Defer] `/auth/login` doesn't revoke the prior session family → session sprawl across re-logins/devices; no "revoke all sessions" hook [auth.service.ts loginUser] — deferred: expected for multi-device; add a revoke-all hook with the session-management surface.
- [x] [Review][Defer] SameSite cross-**registrable-domain** caveat — Strict is correct for the same-site dev/prod-subdomain topology, but if web & API end up on different sites in prod, cookies won't be sent (need `lax`/`none` + CSRF). Also: `secure` is gated on `NODE_ENV==="production"` (ensure staging is HTTPS/prod-env); add JWT `iss`/`aud`; log (don't swallow) unexpected argon2 verify errors. — deferred: auth-hardening bundle to revisit when the web client + prod domains are chosen.

**Dismissed (4):** SameSite=Strict "breaks the :3000→:4000 client" (false positive — SameSite keys on *site*/registrable-domain, not port/origin; `localhost:3000`↔`:4000` is same-site, cookies are sent; the genuine cross-domain case is deferred above); `alg` pinned to HS256 (clean — blocks alg-confusion/`none`); refresh partial-failure forced-logout (issueAccessToken is pure crypto, won't realistically throw; negligible); SHA-256 vs argon2 for refresh tokens (correct by design — 256-bit random, not a low-entropy secret).

## Dev Notes

### ⚠️ Key decision flagged: this story adds a schema model + migration
Story 1.1 said "don't edit the schema," but that was 1.1-scoped. AC#2/#3 (invalidate old refresh token + reuse detection) **cannot be satisfied statelessly** — a stateless JWT can't be invalidated without a server-side denylist. The settled, interview-defensible design is **opaque rotating refresh tokens stored hashed in DB**, which requires a `RefreshToken` table. The architecture explicitly lists "auth + token storage" as a critical concern (architecture.md:89) and "JWT + refresh rotation" (line 103) without precluding a token table. **Proceed with the model addition.** If you'd rather not touch the schema, the only alternative is JWT refresh tokens with a DB jti-allowlist — which still needs the same table, so there's no stateless path. (Flagged for the reviewer.)

### The design (be precise — easy to get subtly wrong)
- **Access token = JWT** (`jose`, HS256, `JWT_ACCESS_SECRET`), short TTL (15m), claim `sub = userId`. Stateless; verified per-request by `requireAuth`.
- **Refresh token = opaque random** (32 bytes base64url), **NOT a JWT**. Stored as a **SHA-256 hash** (`token_hash`, unique) — never plaintext. High entropy ⇒ SHA-256 is sufficient (argon2's slowness is for low-entropy passwords; don't argon2 the refresh token). TTL 7d.
- **Rotation:** every `/auth/refresh` revokes the presented token and issues a brand-new one in the same `family_id`.
- **Reuse detection:** a token is "used" once → revoked. If a *revoked* token is presented again, it's either an attacker replaying a stolen token or a client bug — revoke the **whole family** and 401. This is the standard refresh-token-rotation theft response.
- **Generic error + timing safety:** wrong email and wrong password must return the **same** `401` body. On a missing user, still run an `argon2.verify` against a constant dummy PHC hash so response time doesn't leak which emails exist. Generate the dummy once at module load (`await argon2.hash("x", ARGON2_OPTIONS)` — or a hardcoded valid `$argon2id$` string).

### `RefreshToken` model (exact shape)
```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  tokenHash String    @unique @map("token_hash")
  familyId  String    @map("family_id")
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
  @@map("refresh_tokens")
}
```
RLS migration `0006` (mirror `0002_enable_rls`): `ENABLE` + `FORCE ROW LEVEL SECURITY` on `refresh_tokens`, plus `CREATE POLICY "refresh_tokens_isolation" ON "refresh_tokens" FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')) WITH CHECK (...)`. The `clarifi_app` grant is auto-applied by `0003`'s ALTER DEFAULT PRIVILEGES — keep it (a future "my active sessions" screen can list via `withUserContext`). Login/refresh themselves use the base client (pre-auth), so they bypass RLS and look up by the unique `token_hash`.

### Reuse — do NOT recreate (build on Stories 1.1 & 1.2)
- **Reuse the error contract**: `AppError` + `errorMiddleware` already exist ([apps/api/src/lib/app-error.ts], [apps/api/src/middleware/error.ts]). Just add an `unauthorized()` (401) helper. Do not invent a second error shape.
- **Reuse `argon2`** (already a dep) and its `ARGON2_OPTIONS` pattern from [auth.service.ts](apps/api/src/modules/auth/auth.service.ts).
- **Reuse the shared-Zod pattern** in [auth.ts](packages/shared/src/auth.ts); reuse the email sub-shape for `LoginInput`.
- **Reuse the base `prisma` client + the documented pre-auth exception** established in Story 1.2's `registerUser` (login/refresh are the same: pre-context, base client).
- **Reuse the migration authoring flow**: `db:migrate:diff` to generate DDL, hand-add RLS, `db:deploy` — exactly as Stories 1.1's `0004`/`0005` and the `db:migrate` fix established.
- Mount new routes in [app.ts](apps/api/src/app.ts) `createApp()`; the error middleware stays last.

### Library: `jose` (not `jsonwebtoken`)
`jose` is ESM-native (this is an ESM project: `"type": "module"`, `.js` import specifiers), zero-dep, and has clean `SignJWT`/`jwtVerify` APIs. Secret is a `Uint8Array` (`new TextEncoder().encode(config.JWT_ACCESS_SECRET)`). `jsonwebtoken` is CJS and clunkier under NodeNext. Pin a current major; verify the API against the installed version (don't guess option names).

### Cookies (Express specifics)
- Express's `res.cookie(name, value, opts)` / `res.clearCookie(name, opts)` are built-in (no extra dep; `cookie-parser` is only for *reading* `req.cookies`).
- `clearCookie` must be called with the **same** `path`/`sameSite`/`secure` options used to set it, or the browser won't clear it. The refresh cookie's `path: "/auth"` matters here.
- In tests (`NODE_ENV=test`), `secure` is false so supertest (plain http) receives the cookies. Read them from the `set-cookie` response header.

### Testing standards (mirror Stories 1.1/1.2)
- Vitest, co-located `*.test.ts`. Pure units (schema, token helpers) always run; DB-touching e2e gated with `describe.skipIf(!hasDb)` (copy the `hasDb` guard). `apps/api/vitest.config.ts` already loads the root `.env` and runs serially; `.npmrc` `workspace-concurrency=1` keeps cross-package DB tests deterministic.
- For the e2e suite, drive the mounted app with `supertest` (already a devDep). To test rotation: login → capture refresh cookie → call `/auth/refresh` with it → assert new cookie differs and the **old** one now 401s. For reuse: refresh once (rotating A→B), then call `/auth/refresh` again with A → expect 401 and assert B is also now revoked (family revoked).
- Clean up created `users` + `refresh_tokens` in `afterAll` (cascade from user delete handles tokens). Use unique random emails.

### Scope fence
- No web/UI login form (later). No "list my sessions" screen (the RLS grant just leaves the door open). No password reset / email verification (not in Epic 1). `GET /auth/me` + `logout` are included because they're the minimal consumers that make the issued tokens testable and the session usable.

### Project Structure Notes
New/changed files under the architecture's layout (architecture.md:208-219): `apps/api/src/modules/auth/{tokens,tokens.test,auth.service,auth.controller,auth.routes,auth.routes.test}.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/app-error.ts` (add `unauthorized`), `apps/api/src/config.ts` (require `JWT_ACCESS_SECRET` + TTLs), `packages/shared/src/auth.ts` (+`LoginInput`) and `auth.test.ts`, `packages/shared/prisma/schema.prisma` (+`RefreshToken`), `packages/shared/prisma/migrations/0006_refresh_tokens/migration.sql`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] (ACs)
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] (argon2id, JWT + refresh rotation, httpOnly/Secure/SameSite cookies; "auth + token storage" is a critical concern)
- [Source: CLAUDE.md] (RLS via `withUserContext`; validate input with Zod; import types from `@clarifi/shared`; no PII logged)
- [Source: apps/api/src/modules/auth/auth.service.ts] (argon2 options, base-prisma pre-auth exception, P-code error mapping)
- [Source: apps/api/src/middleware/error.ts] (error contract to extend with 401)
- [Source: packages/shared/prisma/migrations/0002_enable_rls/migration.sql] (RLS policy shape to mirror for `refresh_tokens`)
- [Source: packages/shared/prisma/migrations/0003_app_role/migration.sql] (ALTER DEFAULT PRIVILEGES auto-grants new tables to clarifi_app)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- `db:migrate:diff` (`--from-migrations`) needs a shadow DB (Supabase limitation, per Story 1.1). Authored `0006` incrementally via `prisma migrate diff --from-config-datasource --to-schema --script` (live DB → target datamodel) instead, then hand-appended the RLS block. Updated `db:migrate:diff` note accordingly is deferred — used the config-datasource form directly this story.
- First migrate-diff hit a transient `P1001` (direct host unreachable); retried and it connected — both Supabase hosts were reachable (verified with `nc`).
- Initial `DUMMY_HASH` was a fabricated PHC string; argon2.verify would have failed to parse it and returned fast, defeating the timing-equalization goal. Replaced with a lazily-computed real argon2id hash so the no-user path does genuine verify work.
- Express `Request.userId` augmentation: `declare module "express-serve-static-core"` didn't resolve under NodeNext; used `declare global { namespace Express { interface Request {...} } }` instead.

### Completion Notes List

- All 6 ACs satisfied. Access token = JWT (`jose`, HS256, 15m); refresh token = opaque 32-byte random stored **SHA-256-hashed** in the new `refresh_tokens` table; every `/auth/refresh` rotates (revoke old + issue new in the same `familyId`); presenting a revoked token revokes the whole family (reuse/theft response).
- Login is **timing-safe** (dummy argon2 verify on missing user) and returns a **byte-identical generic 401** for wrong-email vs wrong-password (e2e-asserted).
- `requireAuth` middleware verifies the access cookie → `req.userId`; `GET /auth/me` (protected) and `POST /auth/logout` (revoke + clear cookies) included as the minimal token consumers.
- Cookies: httpOnly, Secure (prod only), SameSite=strict; access `path=/`, refresh `path=/auth`; `clearCookie` uses matching options.
- **Schema change (approved):** added `RefreshToken` model + migration `0006_refresh_tokens` (with ENABLE/FORCE RLS + isolation policy), deployed to Supabase. Login/refresh use the base `prisma` client (pre-auth exception, same as registration); lookups by the unique `token_hash`.
- Config: `JWT_ACCESS_SECRET` now required (min 32); added `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL` (jose duration strings). `JWT_REFRESH_SECRET` left optional + documented as unused under opaque-refresh.
- Added dep: `jose` (apps/api). Tests: shared schema (LoginInput) + api token-helper units + extended supertest e2e (login/refresh/logout/me, rotation, reuse-detection, identical-error). Repo suite **51/51** (shared 25, api 26) green over two runs; `pnpm -r typecheck` clean.

### File List

- `packages/shared/prisma/schema.prisma` (modified — `RefreshToken` model + User relation)
- `packages/shared/prisma/migrations/0006_refresh_tokens/migration.sql` (new — table + indexes + FK + RLS)
- `packages/shared/src/auth.ts` (modified — shared `emailField`, `LoginInput`)
- `packages/shared/src/auth.test.ts` (modified — LoginInput tests)
- `apps/api/src/config.ts` (modified — require `JWT_ACCESS_SECRET`, add TTLs)
- `apps/api/src/lib/app-error.ts` (modified — `unauthorized` helper)
- `apps/api/src/modules/auth/tokens.ts` (new — JWT + opaque-token helpers)
- `apps/api/src/modules/auth/tokens.test.ts` (new — token-helper units)
- `apps/api/src/modules/auth/cookies.ts` (new — auth cookie set/clear helpers)
- `apps/api/src/middleware/auth.ts` (new — `requireAuth` + Request augmentation)
- `apps/api/src/modules/auth/auth.service.ts` (modified — login / rotate / revoke / getPublicUser)
- `apps/api/src/modules/auth/auth.controller.ts` (modified — login / refresh / logout / me)
- `apps/api/src/modules/auth/auth.routes.ts` (modified — /login, /refresh, /logout, /me)
- `apps/api/src/modules/auth/auth.routes.test.ts` (modified — login/session e2e suite)
- `apps/api/package.json` (modified — add `jose`)
- `pnpm-lock.yaml` (modified — new dep)

## Change Log

- 2026-06-15: Story created (ready-for-dev). Design prescribes opaque rotating refresh tokens (hashed in DB) + JWT access tokens with reuse detection; flags the required `RefreshToken` schema addition for reviewer awareness.
- 2026-06-15: Implemented Story 1.3 — login + JWT access + opaque rotating refresh tokens (hashed, family-based reuse detection), `requireAuth`/`/auth/me`/`/auth/logout`, timing-safe generic login error. Added `RefreshToken` model + migration `0006` (RLS, deployed) and `jose`. Repo suite 51/51 green; typecheck clean. Status → review.
- 2026-06-15: Code review applied — 4 patches (atomic rotation w/ conditional-revoke guard + concurrency test, single TTL parser + boot validation, deeper auth tests, removed dead JWT_REFRESH_SECRET); 6 deferred, 4 dismissed. Repo suite 53/53 green over two runs; typecheck clean. Status → done.
