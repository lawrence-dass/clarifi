# Epic 6: Natural Language Query

Users ask questions and get safe, accurate answers.

## Story 6.1: NL to IR generation

As a user,
I want my question turned into a structured query spec,
So that the system understands me without writing raw SQL.

**Acceptance Criteria:**

**Given** a natural-language question
**When** the LLM processes it
**Then** it returns a constrained IR (metric, dimensions, filters, time range, interpretation) validated by the Zod IR schema
**And** any IR failing validation is rejected before SQL is built.

## Story 6.2: IR to parameterized SQL with safety

As the system,
I want to compile the IR to safe SQL,
So that queries cannot leak data or run away.

**Acceptance Criteria:**

**Given** a valid IR
**When** it is compiled
**Then** parameterized SQL is generated and executed under `withUserContext` (RLS) on a read-only role with statement_timeout=2s and a mandatory LIMIT
**And** an AST allowlist rejects anything but SELECT over known tables/columns/aggregates
**And** even a WHERE-less query returns only the requesting user's rows.

## Story 6.3: Query chat UI with answer, chart, and interpretation

As a user,
I want answers with a chart and a plain restatement,
So that I trust the result.

**Acceptance Criteria:**

**Given** an executed query
**When** results return
**Then** the UI shows the numeric answer, a supporting chart, and "I interpreted this as ..."
**And** sanity-bound failures are surfaced rather than shown as a confident wrong number.
