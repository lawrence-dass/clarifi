# Epic 7: FDX & Open Banking

Users experience the Canadian open-banking consent model.

## Story 7.1: FDX mock resources & adapter

As an interviewer/user,
I want Clarifi to expose FDX-shaped resources,
So that it demonstrates open-banking readiness.

**Acceptance Criteria:**

**Given** the FDX mock layer
**When** resources are requested
**Then** Accounts, Transactions, Customer, and Consent are returned in FDX-shaped schema mapped from the canonical model (anti-corruption layer)
**And** the core app remains provider-agnostic.

## Story 7.2: OAuth2 consent flow

As a user,
I want to grant and revoke scoped data access,
So that I control my data (consumer-driven).

**Acceptance Criteria:**

**Given** the FDX consent endpoint
**When** I authorize
**Then** a scoped consent grant + access token is issued and a Consent row recorded
**And** revoking sets status=revoked and blocks further FDX data access.

## Story 7.3: Consent dashboard

As a user,
I want to see and manage my granted consents,
So that I can revoke access anytime.

**Acceptance Criteria:**

**Given** active consents
**When** I open the consent dashboard
**Then** I see granted scopes and grant dates with a revoke action
**And** revoking updates the UI and the Consent row.
