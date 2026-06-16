# Lean BMAD Token Optimization Proposal

Date: 2026-06-16

## Purpose

This document proposes a lower-token execution model for BMAD-assisted development in Clarifi. It is intended for review by another agent before being promoted into a Codex instruction, Claude instruction, BMAD customization, reusable skill, or implementation playbook.

The goal is to reduce token usage during story creation, implementation, code review, and verification without materially lowering code quality.

## Problem

The current default workflow often uses the most exhaustive version of every phase:

- Create a fully context-rich BMAD story.
- Implement the story.
- Load broad project context repeatedly.
- Run multi-agent code review.
- Fix all review issues.
- Run targeted and full test suites.
- Update story records and sprint status.

This produces strong quality, but it can consume a large number of tokens per story. The cost is most noticeable when a story is routine or isolated, because the workflow still pays for broad context loading and multi-layer review even when the risk profile is low.

Story 2.1, the LLM categorization pipeline, was a good example of where the heavier workflow was justified. It touched LLM egress, PII anonymization, Redis/BullMQ, workers, retries, ingestion, outbox durability, and DB writes. The review found meaningful issues.

The problem is not that full BMAD is bad. The problem is using full BMAD for every story regardless of risk.

## Proposed Solution

Adopt a risk-tiered BMAD workflow.

Instead of running the same exhaustive process every time, classify each story before implementation and select the appropriate level of context, review, and verification.

## Risk Tiers

### Tier 1: Low Risk

Use for isolated or mostly presentational changes.

Examples:

- UI layout changes.
- Copy or documentation updates.
- Simple dashboard display work.
- Small isolated parser improvements.
- Non-security CRUD changes with clear existing patterns.

Recommended flow:

1. Create or load the story.
2. Read only the story and directly affected files.
3. Implement.
4. Run targeted tests and typecheck if applicable.
5. Run one focused code review.
6. Fix findings.
7. Run targeted tests again.
8. Mark done if acceptance criteria are satisfied.

Expected token savings: 55-70% versus full BMAD.

Quality trade-off: small. The main compromise is less redundancy in review and less chance of catching rare edge cases.

### Tier 2: Medium Risk

Use for backend or cross-file changes that are important but not security-critical.

Examples:

- API endpoints with DB reads/writes.
- Background job logic without sensitive data egress.
- Shared utility changes.
- Business logic affecting multiple screens or modules.
- Integration behavior with mocked external systems.

Recommended flow:

1. Create or load the story.
2. Read the story, directly affected files, and only relevant architecture sections.
3. Implement.
4. Run targeted tests and typecheck.
5. Run one adversarial code review focused on acceptance criteria, regressions, data integrity, test gaps, and operational failure modes.
6. Fix findings.
7. Run targeted tests again.
8. Run broader API or package tests if the change touches shared behavior.
9. Mark done after verification.

Expected token savings: 35-55% versus full BMAD.

Quality trade-off: moderate but controlled. Some edge-case review depth is reduced, but typecheck, tests, and an adversarial review remain.

### Tier 3: High Risk

Use full BMAD flow.

Examples:

- Authentication or session handling.
- PIPEDA/privacy-sensitive behavior.
- RLS or tenant isolation.
- Account deletion or destructive data operations.
- Migrations or schema changes.
- Financial calculations.
- LLM egress or natural-language-to-query behavior.
- Webhooks, outbox, retries, idempotency, or cursor sync.
- Notifications that could alert users incorrectly.

Recommended flow:

1. Create a fully context-rich BMAD story.
2. Implement with relevant project and architecture context loaded.
3. Run targeted tests and typecheck.
4. Run multi-layer/adversarial code review.
5. Fix all accepted findings.
6. Run targeted tests again.
7. Run full relevant test suite.
8. Update story record and sprint status.

Expected token savings: 10-25% at most. This tier should not be aggressively optimized.

Quality trade-off: minimal. High-risk stories keep the strongest review and verification path.

## Suggested Default Policy

Use Tier 2 as the default.

Escalate to Tier 3 when the story touches security, privacy, tenancy, money, schema, LLM egress, or reliability-critical async behavior.

Downgrade to Tier 1 only when the change is isolated, easily reversible, and covered by existing patterns.

## Review Strategy

The proposed lean review should still be adversarial. It should focus on findings, not summaries.

For Tier 1 and Tier 2 stories, a single focused review should check:

- Acceptance criteria coverage.
- Behavioral regressions.
- Missing or weak tests.
- Data integrity risks.
- Security and privacy concerns.
- Error handling and operational failure modes.
- Whether implementation follows local patterns.

For Tier 3 stories, keep the current full review approach, including multiple review angles when useful.

## Context Loading Strategy

To save tokens, avoid broad context loading by default.

Recommended context rules:

- Always read the story.
- Always read directly affected files before editing.
- Read architecture only for the relevant section.
- Read PRD/epics only when the story lacks enough detail.
- Avoid re-reading large generated files unless needed.
- Avoid loading historical story files unless the current story depends on their implementation.
- Use search first, then open only the files needed to answer the implementation question.

This should work for both Codex and Claude-style agents because it does not depend on one toolchain. It is a workflow policy, not a model-specific behavior.

## Verification Strategy

Do not remove verification. Scale it by risk.

Recommended checks:

- Tier 1: targeted tests, typecheck if code changed.
- Tier 2: targeted tests, typecheck, package-level tests when shared behavior changed.
- Tier 3: targeted tests, typecheck, full relevant test suite.

Full workspace tests should be reserved for:

- High-risk stories.
- Shared package changes.
- Auth/privacy/tenancy changes.
- DB/schema changes.
- Async reliability changes.
- Final checks before marking an epic complete.

## Estimated Token Savings

Actual savings depend on story size and how much context the agent needs. Practical estimates:

| Story Type | Lean Flow Cost Compared To Full BMAD | Estimated Savings |
| --- | ---: | ---: |
| Low-risk UI/API/docs | 30-45% | 55-70% |
| Medium-risk backend | 45-65% | 35-55% |
| High-risk security/privacy/LLM | 75-90% | 10-25% |

Across an epic with mostly Tier 1 and Tier 2 stories, expected total savings are roughly 40-60%.

Across an epic dominated by privacy, auth, LLM, RLS, or migrations, expected savings are lower, roughly 10-30%.

## Quality Trade-Offs

The main compromise is not lower implementation standards. The compromise is less exhaustive review on lower-risk work.

What is preserved:

- Story-driven implementation.
- Acceptance criteria tracking.
- Codebase pattern matching.
- Targeted tests.
- Typechecking.
- Code review.
- Fixing review findings.
- Full review for high-risk work.

What is reduced:

- Repeated broad context loading.
- Multi-agent review on routine changes.
- Full workspace test runs on every story.
- Extensive story-record detail for low-risk stories.

Risks introduced:

- A low-risk story may be misclassified and receive too little review.
- Rare edge cases may be missed when multi-agent review is skipped.
- Some documentation detail may be less exhaustive.
- Final quality depends more on correctly choosing the risk tier.

Mitigations:

- Default to Tier 2 when uncertain.
- Escalate to Tier 3 if implementation reveals hidden risk.
- Require full tests before marking an epic complete.
- Keep a short review checklist even for Tier 1.
- Never skip review for security, privacy, tenancy, money, LLM egress, or schema changes.

## Candidate Instruction For Future Agent Runs

The following instruction could be used manually or converted into a skill/customization:

```text
Use risk-tiered lean BMAD.

First classify the story as Tier 1, Tier 2, or Tier 3.

Tier 1: isolated low-risk changes. Read the story and directly affected files only. Implement, run targeted tests/typecheck, do one focused review, fix findings, and mark done.

Tier 2: normal backend or multi-file changes. Read the story, affected files, and relevant architecture sections only. Implement, run targeted tests/typecheck, do one adversarial review, fix findings, then run package-level tests if shared behavior changed.

Tier 3: auth, privacy, RLS, money, schema, LLM egress, outbox/webhooks, destructive data, or high-reliability async behavior. Use full BMAD context, multi-layer review, and full relevant tests.

When uncertain, choose Tier 2. Escalate to Tier 3 if risk appears during implementation.
```

## Open Review Questions

1. Should this become a BMAD skill, a Codex instruction, a Claude instruction, or a repo-local development guide?
2. Should the risk tier be recorded in each story file?
3. Should sprint status include a field for review depth or quality gate?
4. Should Tier 1 stories be allowed to skip full BMAD story creation, or should all stories still get formal BMAD story files?
5. Should there be a mandatory full-test checkpoint before each epic is marked done?

## Recommendation

Adopt the risk-tiered approach as a working policy.

Do not replace full BMAD. Reserve it for high-risk stories where the extra review depth is valuable. Use lean BMAD for routine stories to reduce token usage while preserving acceptance criteria discipline, tests, typecheck, and review.
