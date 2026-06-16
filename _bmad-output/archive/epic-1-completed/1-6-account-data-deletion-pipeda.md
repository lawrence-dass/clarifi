---
story_key: 1-6-account-data-deletion-pipeda
epic: 1
story: 6
title: Account & data deletion (PIPEDA)
status: done
baseline_commit: 65a0310
created: 2026-06-16
context:
  - _bmad-output/planning-artifacts/epics.md#story-16-account--data-deletion-pipeda
  - _bmad-output/planning-artifacts/architecture.md#enforcement-guidelines
  - CLAUDE.md#privacy
  - packages/shared/prisma/schema.prisma
  - packages/shared/prisma/migrations/0002_enable_rls/migration.sql
  - apps/api/src/modules/auth/
---

# Story 1.6: Account & Data Deletion (PIPEDA)

## Status

done

## Story

As a user, I want to delete my account and all my data, so that my PIPEDA right to erasure is honored.

## Acceptance Criteria

1. Given an authenticated user requests account deletion, when deletion is confirmed, then the current user's account row is deleted and all user-owned rows are removed through database cascades.
2. The deleted scope includes at minimum accounts, transactions, budgets, anomalies, consents, and refresh tokens, matching the user-owned relations in `packages/shared/prisma/schema.prisma`.
3. Deletion must not delete or expose another user's data.
4. The response confirms end-to-end deletion and includes a note on LLM-provider log handling.
5. Auth cookies are cleared after deletion, and stale access/refresh credentials for the deleted account cannot continue using authenticated API routes.
6. Unauthenticated deletion attempts return the existing 401 error contract.
7. Destructive deletion requires explicit confirmation and current-password re-authentication.

## Tasks / Subtasks

- [x] Add authenticated account deletion behavior to the API.
  - [x] Add a deletion service that deletes the current user under `withUserContext`.
  - [x] Add a `DELETE /auth/me` controller/route consistent with existing auth endpoints.
  - [x] Require current-password re-authentication and `confirm: "DELETE"` before deletion.
  - [x] Clear auth cookies and return a confirmation payload with LLM-provider log handling language.
- [x] Ensure deleted users cannot keep using old credentials.
  - [x] Tighten `requireAuth` so verified JWTs whose user row no longer exists are rejected.
  - [x] Ensure refresh tokens are removed by cascade and cannot be rotated after deletion.
- [x] Add route-level regression tests.
  - [x] Deleting one user cascades user-owned rows and refresh tokens.
  - [x] Deleting one user leaves another user's data intact.
  - [x] The deletion response contains the confirmation and LLM-provider log note.
  - [x] Missing confirmation or wrong current password prevents deletion.
  - [x] Old access and refresh cookies no longer authenticate after deletion.
  - [x] Anonymous deletion returns 401.
- [x] Run verification.
  - [x] `pnpm -r typecheck`
  - [x] Focused auth route test
  - [x] `pnpm -r test`

## Dev Notes

- Existing auth routes are mounted at `/auth` in `apps/api/src/app.ts`; `GET /auth/me` already represents the current user resource, so deletion should extend that resource as `DELETE /auth/me`.
- `packages/shared/prisma/schema.prisma` already defines `onDelete: Cascade` from `User` to `Account`, `Transaction`, `Budget`, `Anomaly`, `Consent`, and `RefreshToken`. Do not manually delete child rows unless a cascade gap is discovered.
- RLS policy `users_delete` permits deleting only the row whose id equals `app.current_user_id`. Use `withUserContext(userId, ...)` for the deletion so the database remains the tenancy enforcement boundary.
- Story 1.3 left access tokens stateless. For PIPEDA deletion, a verified JWT must also correspond to an existing user row; otherwise a deleted user could keep accessing protected routes until token expiry.
- The architecture requires no PII logging and only anonymized descriptions to LLM providers. This story cannot delete third-party provider logs directly; the API response must state that Clarifi data is deleted and that any LLM-provider logs contain only anonymized payloads subject to provider retention.
- Preserve the existing error contract: `{ error: { code, message, details? } }`.

## Dev Agent Record

### Debug Log

- 2026-06-16: Started implementation. Selected `DELETE /auth/me` to extend the existing current-user auth resource.
- 2026-06-16: Typecheck passed.
- 2026-06-16: Focused auth route tests passed.
- 2026-06-16: Full workspace test suite passed.
- 2026-06-16: Code review self-pass found and fixed auth middleware error masking; moved `GET /auth/me` lookup under RLS.
- 2026-06-16: Blind review required destructive-action confirmation/reauth and a policy-sourced provider-log note; patched both.
- 2026-06-16: Edge-case review found bad JWT subject handling, login/delete race handling, and concurrent refresh family-revocation race; patched all.
- 2026-06-16: Final post-review verification passed: `pnpm -r typecheck`, focused auth/token/shared tests, and `pnpm -r test`.

### Completion Notes

- Implemented `DELETE /auth/me` with RLS-scoped user deletion and DB cascade reliance.
- Added confirmation response body with LLM-provider log handling note.
- Added explicit `DELETE` confirmation and current-password re-authentication for the destructive deletion route.
- Hardened `requireAuth` to reject access tokens whose subject user no longer exists.
- Hardened access token verification to reject signed tokens with non-UUID subjects.
- Hardened login/refresh races around deleted users and fixed same-token concurrent refresh so the winner's new token remains usable.
- Added HTTP regression coverage for cascade deletion, other-user preservation, stale credential rejection, cookie clearing, and anonymous rejection.

### File List

- _bmad-output/implementation-artifacts/1-6-account-data-deletion-pipeda.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/api/src/middleware/auth.ts
- apps/api/src/modules/auth/auth.controller.ts
- apps/api/src/modules/auth/auth.routes.ts
- apps/api/src/modules/auth/auth.routes.test.ts
- apps/api/src/modules/auth/auth.service.ts
- apps/api/src/modules/auth/tokens.ts
- apps/api/src/modules/auth/tokens.test.ts
- packages/shared/src/auth.ts
- packages/shared/src/auth.test.ts

## Change Log

- 2026-06-16: Story created from Epic 1 Story 1.6 requirements.
- 2026-06-16: Implementation completed and moved to review.
- 2026-06-16: Code review findings fixed; story marked done.

## Senior Developer Review (AI)

**Outcome:** Approve after fixes.

**Review Date:** 2026-06-16

**Findings and Resolution:**

- [x] Medium: destructive account deletion lacked explicit confirmation or re-authentication. Fixed by requiring `currentPassword` and `confirm: "DELETE"` via shared Zod schema.
- [x] Medium: unexpected DB/RLS failures in `requireAuth` could be masked as `401`. Fixed by mapping only JWT verification and missing-user cases to `401`.
- [x] Low: LLM-provider log disclosure was too implicit and hardcoded inline. Fixed with a named policy note that explicitly states this API does not delete third-party provider logs, plus a stronger response test.
- [x] Medium: signed access JWTs with non-UUID subjects could reach `withUserContext` and become `500`. Fixed by validating UUID subjects during token verification.
- [x] Medium: login racing with account deletion could surface a DB error. Fixed by mapping missing-user token issuance races to generic auth failure.
- [x] High: same-token concurrent refresh loser could revoke the winner's newly-issued token family. Fixed by not family-revoking on the conditional update race path, while preserving family revocation for true later replay.

**Verification:**

- `pnpm -r typecheck` passed.
- `pnpm --filter @clarifi/api exec vitest run src/modules/auth/auth.routes.test.ts src/modules/auth/tokens.test.ts` passed.
- `pnpm --filter @clarifi/shared exec vitest run src/auth.test.ts` passed.
- `pnpm -r test` passed: shared 26 tests, API 50 tests.
