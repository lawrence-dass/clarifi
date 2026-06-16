# Epic 8: Notifications, Observability & Polish

Users stay informed; the system is observable and production-credible.

## Story 8.1: In-app anomaly notifications

As a user,
I want to be notified of new critical anomalies,
So that I act quickly.

**Acceptance Criteria:**

**Given** a newly detected critical anomaly
**When** it is created
**Then** an in-app notification appears
**And** info/warning anomalies do not push but remain in the feed.

## Story 8.2: Budget alerts at 80% and 100%

As a user,
I want alerts as I approach a budget,
So that I avoid overspending.

**Acceptance Criteria:**

**Given** a category budget
**When** spend crosses 80% and 100% of the monthly limit
**Then** an alert fires once per threshold per month
**And** alerts reset at month rollover.

## Story 8.3: Weekly email digest

As a user,
I want an optional weekly spending summary email,
So that I stay aware without opening the app.

**Acceptance Criteria:**

**Given** a user opted into the digest
**When** the weekly job runs
**Then** a summary email is sent with the week's spend, top categories, and any anomalies
**And** opted-out users receive nothing.

## Story 8.4: Observability & CI

As an engineer,
I want tracing, dashboards, and CI,
So that the system is debuggable and changes are safe.

**Acceptance Criteria:**

**Given** the running services
**When** requests and jobs execute
**Then** OpenTelemetry traces span web/api/workers and dashboards cover categorization latency, anomaly precision, and webhook lag
**And** GitHub Actions runs typecheck + test + build on every PR.
