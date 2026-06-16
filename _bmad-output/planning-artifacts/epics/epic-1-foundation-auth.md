# Epic 1: Foundation & Auth

Users can securely sign up, sign in, and load transactions via CSV. Establishes the persistence layer, RLS, and the canonical ingestion path.

## Story 1.1: Persistence foundation & RLS enablement

As a Clarifi user,
I want my data stored in a securely isolated database,
So that no other user can ever see my financial data.

**Acceptance Criteria:**

**Given** the Prisma 7 schema (User, Account, Transaction, Budget, Anomaly, Consent, Outbox)
**When** `prisma migrate` is run against Supabase
**Then** all tables are created with snake_case names, integer-cents money columns, and the unique (account_id, provider_transaction_id) constraint
**And** a raw-SQL migration enables ROW LEVEL SECURITY and adds per-table policies keyed on `app.current_user_id`
**And** a test proves a query inside `withUserContext(userA)` returns zero rows belonging to userB even with no WHERE clause.

## Story 1.2: User registration with email & PIPEDA consent

As a new user,
I want to register with email and password and consent to data processing,
So that I have a PIPEDA-compliant account.

**Acceptance Criteria:**

**Given** a registration request with email, password, and consent=true
**When** the request is validated by Zod and the password hashed with argon2id (t=3, m=64MiB, p=1)
**Then** a User row is created with `consented_at` set and only the password hash stored
**And** registration is rejected if consent is false, the email is already used, or the password fails policy.

## Story 1.3: User login with JWT and refresh rotation

As a registered user,
I want to log in and stay authenticated securely,
So that my session is protected.

**Acceptance Criteria:**

**Given** valid credentials
**When** I log in
**Then** an access token and a rotating refresh token are issued in httpOnly, Secure, SameSite cookies
**And** using a refresh token issues a new pair and invalidates the old refresh token (rotation)
**And** invalid credentials return a generic error without revealing which field was wrong.

## Story 1.4: CSV statement upload & canonical parsing

As a user,
I want to upload a bank CSV and have it parsed,
So that my transactions appear in Clarifi.

**Acceptance Criteria:**

**Given** a TD/RBC/Scotiabank CSV
**When** I upload it
**Then** rows are parsed into the canonical model via the CSV adapter, amounts stored as signed integer cents (outflow negative), currency captured
**And** the provider sign convention is normalized once at ingestion
**And** malformed rows are reported without aborting the whole import.

## Story 1.5: Idempotent ingestion & duplicate detection

As a user,
I want re-uploading the same statement to not create duplicates,
So that my data stays accurate.

**Acceptance Criteria:**

**Given** a statement already imported
**When** I upload it again
**Then** existing transactions are upserted on (account_id, provider_transaction_id) with no duplicates created
**And** genuinely new rows in the re-upload are added.

## Story 1.6: Account & data deletion (PIPEDA)

As a user,
I want to delete my account and all my data,
So that my PIPEDA right to erasure is honored.

**Acceptance Criteria:**

**Given** an authenticated user requesting deletion
**When** deletion is confirmed
**Then** all rows owned by the user (accounts, transactions, budgets, anomalies, consents) are removed via cascade
**And** the response confirms end-to-end deletion including a note on LLM-provider log handling.
