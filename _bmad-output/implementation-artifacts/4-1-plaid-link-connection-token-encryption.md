---
risk_tier: 3
baseline_commit: 1de8fe5
context:
  - _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.1
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Authentication & Security
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md
  - packages/shared/prisma/schema.prisma
  - packages/shared/prisma/migrations/0002_enable_rls/migration.sql
  - packages/shared/src/canonical.ts
  - CLAUDE.md
---

# Story 4.1: Plaid Link connection & token encryption

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to connect a bank through Plaid Link,
so that my accounts are linked and ready to sync transactions automatically.

**Scope note:** Backend only — link-token creation, public-token exchange, AES-256-GCM token encryption at rest, and Account creation via the Plaid adapter (canonical model). The browser Plaid Link widget UI and transaction sync are deferred: transaction sync is Story 4.2; the web Link button can be a later UI story (the exchange endpoint is testable via the Plaid sandbox `public_token` without a UI). No transactions are ingested in this story.

## Acceptance Criteria

1. **Link token:** an authenticated `POST /accounts/plaid/link-token` returns a Plaid `link_token` for the sandbox, scoped to the authenticated user. No secrets (client_id/secret/access_token) are returned to the client.
2. **Exchange & connect:** an authenticated `POST /accounts/plaid/exchange` with `{ publicToken }` exchanges it for an `access_token` + `item_id` via the Plaid adapter, then creates/updates the linked accounts through the canonical model. Returns only safe account data (`id`, `institutionName`, `accountType`, `currency`, masked/last4 if available) — never the access token or item secrets.
3. **Encryption at rest (guardrail):** the Plaid `access_token` is stored **AES-256-GCM encrypted** via a new `lib/crypto.ts`, using a 32-byte key from `ENCRYPTION_KEY` (env/secret). A fresh random IV per encryption; the stored value is self-describing (version + IV + auth tag + ciphertext) so it can be decrypted and rotated. The plaintext token is never persisted.
4. **Never logged or returned (guardrail):** the raw `access_token` (and `publicToken`) never appear in logs, error messages, or any HTTP response. Logs about the connection contain only non-secret identifiers (e.g. `itemId`, account count).
5. **Schema + RLS (guardrail):** a new `PlaidItem` model (denormalized `userId`, unique `itemId`, encrypted access token, `institutionName`, nullable `cursor` for Story 4.2) is added, and `Account` gains a nullable `plaidItemId`. The migration **enables and FORCEs RLS** on `plaid_items` with a `user_id`-isolation policy mirroring `0002_enable_rls`. All reads/writes go through `withUserContext(userId)`; `userId` comes from the session, never the body.
6. **Provider anti-corruption (guardrail):** the Plaid SDK is imported in exactly one place — `apps/api/src/lib/plaid-adapter.ts` — which maps Plaid's account shape into the canonical model (`provider = plaid`, `providerAccountId = Plaid account_id`, mapped `AccountType`, `balanceCents` via `dollarsToCents`, ISO currency). The rest of the app never imports the `plaid` package.
7. **Idempotent connect:** re-exchanging for the same `item_id` upserts the `PlaidItem` (refreshing the encrypted token/institution) and upserts accounts on the existing `(provider, providerAccountId)` unique key — no duplicate items or accounts.
8. **Config & safety:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (default `sandbox`), and `ENCRYPTION_KEY` are validated in `config.ts` (fail-fast; `ENCRYPTION_KEY` must decode to exactly 32 bytes). Secrets come from env only; `.env.example` documents placeholders. Unauthenticated requests → `401`; invalid bodies → `400` via the central error envelope.
9. **Tests:** crypto round-trip + tamper/wrong-key failure (GCM auth) + output excludes plaintext; adapter mapping (Plaid → canonical, with a fake Plaid client); Supertest exchange (fake Plaid client injected) asserting accounts + PlaidItem created, the DB column holds ciphertext (not the token), the response/body/logs contain no token, idempotent re-exchange, `401`, and tenant isolation. DB-backed tests use the `hasDb` skip; no real Plaid network.

## Tasks / Subtasks

- [x] Task 1: Schema + RLS migration (AC: #5, #7)
  - [x] Add a `PlaidItem` model to `packages/shared/prisma/schema.prisma`: `id`, `userId @map("user_id")`, `itemId @unique @map("item_id")`, `accessTokenEncrypted @map("access_token_encrypted")` (String), `institutionName`, `cursor String? ` (nullable, for 4.2), timestamps, `user` relation (onDelete: Cascade), `@@index([userId])`, `@@map("plaid_items")`. Add nullable `plaidItemId @map("plaid_item_id")` + relation on `Account` (CSV accounts have none).
  - [x] Create migration `0007_plaid_items`: the table/column DDL (generate the DDL via `pnpm --filter @clarifi/shared db:migrate:diff` as a starting point) **plus** hand-added RLS — `ALTER TABLE "plaid_items" ENABLE/FORCE ROW LEVEL SECURITY` and a `plaid_items_isolation` policy `USING/WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))`, mirroring `0002_enable_rls`. (Table grants for `clarifi_app` apply automatically via the `0003` default privileges.)
  - [x] Run `pnpm --filter @clarifi/shared db:generate` after the schema change (Prisma 7 generate is manual).

- [x] Task 2: Encryption module (AC: #3, #4)
  - [x] `apps/api/src/lib/crypto.ts`: `encryptSecret(plaintext): string` and `decryptSecret(encoded): string` using Node `crypto` `aes-256-gcm`. Random 12-byte IV per call; encode as a versioned, self-describing string (e.g. `v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>`). Key loaded once from `config.ENCRYPTION_KEY` (32 bytes). Decrypt verifies the auth tag (throws on tamper). Never log inputs/outputs.
  - [x] `crypto.test.ts`: round-trip; decrypt fails on a tampered tag/ciphertext and on a wrong key; encrypted output never contains the plaintext; two encryptions of the same input differ (random IV).

- [x] Task 3: Plaid adapter (AC: #1, #2, #6)
  - [x] `apps/api/src/lib/plaid-adapter.ts` — the **only** importer of the `plaid` SDK. Functions: `createLinkToken(userId)`, `exchangePublicToken(publicToken) -> { accessToken, itemId }`, `getItemAccounts(accessToken) -> CanonicalAccount[]`. Map Plaid accounts → canonical (`provider: plaid`, `providerAccountId`, `institutionName`, `accountType` mapped to the `AccountType` enum, `balanceCents` via `dollarsToCents`, ISO `currency`). Construct the client from `PLAID_CLIENT_ID/SECRET/ENV`. Make the client injectable for tests.
  - [x] Add the `plaid` dependency to `apps/api`.

- [x] Task 4: Accounts module — connect flow (AC: #1, #2, #4, #5, #7, #8)
  - [x] `apps/api/src/modules/accounts/` (`accounts.routes.ts`, `accounts.controller.ts`, `accounts.service.ts`), mounted at `/accounts` in `app.ts`, behind `requireAuth`.
  - [x] `POST /accounts/plaid/link-token` → controller calls the adapter, returns `{ linkToken }`.
  - [x] `POST /accounts/plaid/exchange` (Zod body `{ publicToken: string }`) → service inside `withUserContext(userId)`: exchange → `encryptSecret(accessToken)` → upsert `PlaidItem` on `itemId` → fetch accounts via adapter → upsert `Account` rows on `(provider, providerAccountId)` with `plaidItemId`. Return safe account summaries only.
  - [x] Pass errors to `next(err)`; never include the token in an error.

- [x] Task 5: Config (AC: #8)
  - [x] Add to `config.ts`: `PLAID_CLIENT_ID`, `PLAID_SECRET` (required when Plaid is used — keep optional+guarded like `ANTHROPIC_API_KEY` so non-Plaid dev/test still boots), `PLAID_ENV` (enum, default `sandbox`), `ENCRYPTION_KEY` (validate base64 → 32 bytes, fail-fast). Update `.env.example`.

- [x] Task 6: Tests & verification (AC: #9)
  - [x] Adapter test with a fake Plaid client (mapping + token exchange). Accounts route test (Supertest, `hasDb` skip) injecting a fake Plaid client/adapter: exchange creates `PlaidItem` + `Account`(s); assert the stored `access_token_encrypted` is ciphertext (decrypts back, ≠ plaintext) and no token in the response; idempotent re-exchange (no dupes); `401`; tenant isolation (user B can't see user A's item under RLS).
  - [x] Run `pnpm --filter @clarifi/shared db:generate`, `pnpm --filter @clarifi/api typecheck`, and the new tests (apply the `0007` migration to the test DB first). If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3 — this story trips **several** `CLAUDE.md` guardrails at once: Plaid access-token encryption, a Prisma migration + RLS on a new table, RLS-scoped writes, and the provider anti-corruption boundary. Run the guardrail tripwire before done (`git diff --name-only`); expected surfaces are `prisma/schema.prisma` + `prisma/migrations`, `withUserContext`/RLS, money (`balance_cents`), and a new crypto/secret path. Keep the full Tier-3 review.

### Source Story Context

Epic 4 connects real banks (Plaid sandbox) with reliable, exactly-once sync. Story 4.1 is the connection + secure token storage; 4.2 adds webhook/cursor sync; 4.3 the pending→posted→removed lifecycle. [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md]

Epic BDD: *Given the Plaid sandbox, when I complete Plaid Link, then an Account is created via the Plaid adapter (canonical model) and the access token is stored AES-256-GCM encrypted at rest, and the raw access token is never logged or returned to the client.* [Source: epic-4-plaid-reliable-ingestion.md#Story 4.1]

Relevant requirements: FR4/FR5 (connect accounts, reliable sync); the cursor field is seeded here for 4.2. [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- **Plaid token encryption at rest:** AES-256-GCM envelope (Node crypto), key from secrets. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Authentication & Security]
- **Anti-corruption / provider boundary:** `lib/plaid-adapter` maps external shapes into the canonical model; the core never depends on a specific provider. Plaid is interchangeable with CSV/FDX adapters. [Source: project-structure-boundaries.md; CLAUDE.md#FDX / open banking]
- **Tenancy via RLS only:** new table gets ENABLE+FORCE RLS + a `user_id` policy; all access via `withUserContext`. RLS is added by a raw-SQL migration (Prisma doesn't manage RLS). [Source: packages/shared/prisma/migrations/0002_enable_rls/migration.sql; CLAUDE.md#Multi-tenancy & query safety]
- **Money:** `Account.balanceCents` is integer cents — convert Plaid's decimal balances with `dollarsToCents` in the adapter; never store floats. (Transaction sign normalization is Story 4.2's concern; no transactions here.) [Source: CLAUDE.md#Money & data model; packages/shared/src/money.ts]
- **PIPEDA / privacy:** no PII or secrets in logs; the access token is encrypted at rest and never returned. [Source: CLAUDE.md#Privacy]
- **API patterns:** REST, Zod at the boundary, central error envelope, success returns data directly. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]

### Existing System Notes (read before building)

- `Account` is unique on `(provider, providerAccountId)` (the upsert/idempotency key) with a denormalized `userId` and `@@index([userId])`. `Provider` enum already includes `plaid`. The CSV ingestion service (`modules/ingestion/ingestion.service.ts`) shows the `withUserContext` + account upsert pattern to mirror. [Source: packages/shared/prisma/schema.prisma; apps/api/src/modules/ingestion/ingestion.service.ts]
- `CanonicalTransaction` lives in `packages/shared/src/canonical.ts` — add a `CanonicalAccount` shape there (or alongside) if useful so the adapter maps into a shared canonical type, consistent with the anti-corruption pattern. [Source: packages/shared/src/canonical.ts]
- Migrations are hand-authored SQL dirs applied via `prisma migrate deploy`; RLS lives in raw SQL (see `0002`, `0006_refresh_tokens` for the newest pattern). `prisma generate` is manual (`db:generate`). [Source: packages/shared/prisma/migrations/; packages/shared/prisma.config.ts]
- `config.ts` validates env with Zod and guards optional secrets (`ANTHROPIC_API_KEY` pattern) — follow it for Plaid creds so the app still boots without Plaid in dev/test. [Source: apps/api/src/config.ts]
- Injectable-dependency pattern (gateway/merchantCache, judge) — inject the Plaid client/adapter into the service so tests use a fake and never hit Plaid. [Source: apps/api/src/workers/categorize.worker.ts]

### Implementation Guidance

- Store one `access_token_encrypted` column (the crypto module owns the encoding) rather than separate iv/tag columns — simpler schema, self-describing, rotation-friendly via the `v1:` prefix.
- `ENCRYPTION_KEY`: 32 bytes, base64 in env; decode + length-check at boot. A wrong-length key must fail fast, not at first encrypt.
- Plaid `accountType` mapping: map Plaid `type`/`subtype` to the `AccountType` enum (`checking`/`savings`/`credit_card`/`other`); default unknowns to `other`.
- Keep `link-token` and `exchange` thin; the adapter owns all Plaid calls.
- Sandbox testing without a UI: Plaid's `/sandbox/public_token/create` yields a `public_token` you can feed to `exchange` — but in tests, inject a **fake** adapter/client (no network).

### Testing Standards

- No real Plaid network and no real key material in tests — inject a fake Plaid client/adapter; use a test `ENCRYPTION_KEY` (32 bytes) via env in the test setup.
- DB-backed route tests use the `hasDb` skip and require the `0007` migration applied to the test DB; reuse the register/login cookie harness.
- Assert the **ciphertext** invariant directly: read the `plaid_items` row and confirm `access_token_encrypted` ≠ the known fake token and `decryptSecret(...)` returns it.
- Run with explicit timeouts if the 5s DB timeout trips: `--testTimeout=40000 --hookTimeout=40000`.

### Project Structure Notes

Additions: `packages/shared/prisma/migrations/0007_plaid_items/`, `apps/api/src/lib/crypto.ts` (+test), `apps/api/src/lib/plaid-adapter.ts` (+test), `apps/api/src/modules/accounts/*` (+test). Schema edits: `PlaidItem` model + `Account.plaidItemId`. `config.ts` + `.env.example` + `apps/api/package.json` (`plaid`). `app.ts` mounts `/accounts`. Avoid: ingesting transactions (4.2), importing the Plaid SDK outside the adapter, logging/returning the token, and storing the token unencrypted.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-4-plaid-reliable-ingestion.md#Story 4.1]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: packages/shared/prisma/schema.prisma#Account]
- [Source: packages/shared/prisma/migrations/0002_enable_rls/migration.sql]
- [Source: packages/shared/src/canonical.ts]
- [Source: packages/shared/src/money.ts]
- [Source: apps/api/src/modules/ingestion/ingestion.service.ts]
- [Source: apps/api/src/config.ts]
- [Source: CLAUDE.md#FDX / open banking]
- [Source: CLAUDE.md#Privacy]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to a named test/gate; record the mapping in Completion Notes. The encryption-at-rest (#3/#4) and RLS-isolation (#5) ACs each need an explicit test.
- **Guardrail tripwire (mandatory, Tier 3 — multiple surfaces):** run `git diff --name-only`. Confirm in the record: (a) the migration **enables + FORCEs RLS** on `plaid_items` with a `user_id` policy matching `0002`; (b) the access token is AES-256-GCM encrypted with a random per-call IV and a verified auth tag, key from `ENCRYPTION_KEY` (32 bytes, fail-fast) — and the stored column is ciphertext, proven by a test; (c) the raw token/`publicToken` never appear in any response, error, or log; (d) the `plaid` SDK is imported only in `lib/plaid-adapter.ts`; (e) all DB access is via `withUserContext` with `userId` from the session (no `where: { userId }`, no body `userId`); (f) `balance_cents` uses `dollarsToCents` (no float). If the diff touches transaction ingestion/sign normalization (that's 4.2), stop.
- **Edge / failure paths (Edge Case Hunter):** re-exchange same item (idempotent upsert, no dupes); exchange failure from Plaid surfaced without leaking the token; decrypt of a tampered/old-key value throws; missing/short `ENCRYPTION_KEY` fails at boot; unauthenticated → 401; invalid body → 400; a second user cannot read/connect into another's `PlaidItem` (RLS); unknown Plaid account subtype → `other`.
- **Reuse first (Blind Hunter / simplify):** reuse `withUserContext`, the account-upsert pattern from `ingestion.service.ts`, `dollarsToCents`, the config/secret-guard pattern, `badRequest`/`unauthorized`, and the injectable-dependency pattern. Don't hand-roll a second crypto or config approach; one `lib/crypto.ts`, one Plaid adapter.
- **Scope discipline:** no transaction ingestion (4.2), no web Plaid Link UI, no Plaid SDK import outside the adapter. Flag any out-of-scope edit with a rationale.
- **Evidence, not claims:** paste actual results of `db:generate`, `typecheck`, and the crypto/adapter/route tests (with the migration applied) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/shared db:generate` → passed; generated Prisma Client 7.8.0.
- Initial `db:generate` under Node v20.16.0 failed with Prisma 7 CJS/ESM loader issue; reran under repo `.nvmrc` Node 22.22.3.
- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/shared db:migrate` → applied `0007_plaid_items`; 7 migrations successfully applied.
- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/api typecheck` → passed (`tsc --noEmit`).
- `PATH=/Users/lawrence/.nvm/versions/node/v22.22.3/bin:$PATH pnpm --filter @clarifi/api exec vitest run src/lib/crypto.test.ts src/lib/plaid-adapter.test.ts src/modules/accounts/accounts.routes.test.ts --testTimeout=40000 --hookTimeout=40000` → passed; 3 files, 15 tests.
- BMAD code review: local Blind Hunter / Edge Case Hunter / Acceptance Auditor review completed after implementation and tests; 0 decision-needed, 0 patch, 0 defer findings remained.

### Completion Notes List

- Implemented backend-only Plaid Link connection surface: authenticated `POST /accounts/plaid/link-token` and `POST /accounts/plaid/exchange`, mounted under `/accounts`.
- Added single-egress Plaid adapter in `apps/api/src/lib/plaid-adapter.ts`; guardrail check `rg "from ['\"]plaid['\"]|require\\(['\"]plaid['\"]\\)"` found only this file.
- Added `PlaidItem` schema + `Account.plaidItemId` relation and migration `0007_plaid_items`; migration ENABLEs and FORCEs RLS with `plaid_items_isolation` using `app.current_user_id`, mirroring `0002_enable_rls`.
- Added AES-256-GCM envelope crypto (`v1:iv:authTag:ciphertext`) using random 12-byte IV and verified auth tag; `ENCRYPTION_KEY` decodes to exactly 32 bytes and fails fast otherwise. Config accepts valid base64 and the existing local 64-char hex key format.
- Tokens are never returned; route tests assert response bodies omit the raw access token and public token, DB stores ciphertext, and decrypting the ciphertext returns the fake token.
- Plaid adapter maps accounts to `CanonicalAccount`, uses `dollarsToCents` for balances, preserves per-account currency, and defaults unknown types to `other`.
- All production DB writes/reads for this flow are inside `withUserContext(req.userId, ...)`; controllers ignore body user IDs and use the session-derived `req.userId`.
- Plaid provider errors are wrapped as generic `AppError`s so provider exception text containing a token is not returned or logged by the generic error handler.
- AC traceability: AC1 link token route test; AC2 exchange route test; AC3 crypto tests + DB ciphertext assertion; AC4 token-leakage response/error tests; AC5 migration + RLS tenant isolation test; AC6 adapter import/mapping tests; AC7 idempotent re-exchange test; AC8 config validation + 401/400 route tests; AC9 targeted test suite above.

### File List

- `.env.example`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/lib/crypto.ts`
- `apps/api/src/lib/crypto.test.ts`
- `apps/api/src/lib/plaid-adapter.ts`
- `apps/api/src/lib/plaid-adapter.test.ts`
- `apps/api/src/modules/accounts/accounts.controller.ts`
- `apps/api/src/modules/accounts/accounts.routes.ts`
- `apps/api/src/modules/accounts/accounts.routes.test.ts`
- `apps/api/src/modules/accounts/accounts.service.ts`
- `packages/shared/prisma/migrations/0007_plaid_items/migration.sql`
- `packages/shared/prisma/schema.prisma`
- `packages/shared/src/canonical.ts`
- `pnpm-lock.yaml`

## Change Log

- 2026-06-18: Story created (ready-for-dev). Scope is the backend Plaid Link connection — link-token + public-token exchange, AES-256-GCM access-token encryption at rest (new lib/crypto), a new RLS-protected PlaidItem table (migration 0007) + Account.plaidItemId, and Account creation via a single-egress Plaid adapter mapping to the canonical model. Web Link widget + transaction sync deferred (4.2). Not implemented.
- 2026-06-18: Implemented Story 4.1 backend Plaid Link connection, token encryption, RLS migration, adapter/account routes/tests; applied `0007_plaid_items`; passed db:generate, API typecheck, and targeted crypto/adapter/route tests; BMAD code review completed clean. Status set to done.
