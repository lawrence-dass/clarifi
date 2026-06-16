# Epic 5: Anomaly Detection

Users get early warning on unusual spending, explained plainly.

## Story 5.1: Robust-stats engine & baselines

As the system,
I want robust per-user baselines,
So that anomaly detection is accurate on heavy-tailed spending.

**Acceptance Criteria:**

**Given** a user's transaction history
**When** baselines are computed
**Then** median + MAD and a modified z-score (0.6745*(x-median)/MAD) are used (not mean/std)
**And** cold-start falls back merchant->category->global prior with sample-size shrinkage.

## Story 5.2: Velocity & merchant anomaly detection

As a user,
I want unusual transaction patterns flagged,
So that I catch problems early.

**Acceptance Criteria:**

**Given** a new transaction
**When** detection runs
**Then** repeated charges at the same merchant in a short window flag as velocity, and first-time merchants large relative to my typical size flag as merchant anomalies
**And** normal recurring patterns are not flagged.

## Story 5.3: Synchronous detection & severity scoring

As the system,
I want fast deterministic detection on ingestion,
So that flags are real-time without blocking webhooks.

**Acceptance Criteria:**

**Given** an ingested transaction
**When** detection runs synchronously
**Then** it completes in under 10ms with no LLM call and assigns severity info/warning/critical
**And** only critical severity triggers a notification.

## Story 5.4: Async plain-English explanations

As a user,
I want each anomaly explained in plain English,
So that I understand why it was flagged.

**Acceptance Criteria:**

**Given** a flagged anomaly
**When** the explanation worker runs
**Then** an LLM explanation is generated asynchronously and attached
**And** if the LLM is unavailable a templated explanation is shown instead.

## Story 5.5: Anomaly feed & feedback loop

As a user,
I want to dismiss or report anomalies,
So that the system adapts to me.

**Acceptance Criteria:**

**Given** a list of anomalies
**When** I dismiss or report one
**Then** the anomaly updates and the merchant's sensitivity threshold adjusts (dismiss raises, report lowers)
**And** future detection reflects the adjusted threshold.
