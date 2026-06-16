# Epic 4: Plaid & Reliable Ingestion

Users connect real bank accounts with reliable, exactly-once sync.

## Story 4.1: Plaid Link connection & token encryption

As a user,
I want to connect a bank via Plaid Link,
So that my transactions sync automatically.

**Acceptance Criteria:**

**Given** the Plaid sandbox
**When** I complete Plaid Link
**Then** an Account is created via the Plaid adapter (canonical model) and the access token is stored AES-256-GCM encrypted at rest
**And** the raw access token is never logged or returned to the client.

## Story 4.2: Webhook ingestion with outbox & cursor sync

As a user,
I want new transactions to arrive reliably,
So that nothing is lost or duplicated.

**Acceptance Criteria:**

**Given** a Plaid `SYNC_UPDATES_AVAILABLE` webhook
**When** it is received
**Then** the event is written to the outbox and the webhook is acked immediately (never blocked by LLM work)
**And** the outbox dispatcher calls `/transactions/sync` with the stored cursor and upserts idempotently (exactly-once effect)
**And** processing is retried safely on failure without duplicating transactions.

## Story 4.3: Transaction lifecycle (pending to posted to removed)

As a user,
I want pending charges to resolve correctly,
So that my data matches my bank.

**Acceptance Criteria:**

**Given** a pending transaction
**When** Plaid later posts or removes it
**Then** the row transitions status (pending->posted/removed) linking via pending_transaction_id
**And** removed transactions are excluded from dashboard math.
