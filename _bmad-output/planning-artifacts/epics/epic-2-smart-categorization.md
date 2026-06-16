# Epic 2: Smart Categorization

Transactions are auto-categorized and merchant-normalized; corrections teach the system.

## Story 2.1: LLM categorization pipeline

As a user,
I want my transactions automatically categorized,
So that I understand my spending without manual tagging.

**Acceptance Criteria:**

**Given** uncategorized transactions
**When** the categorization worker runs (via the LLM gateway, batched)
**Then** each transaction gets a category from the fixed set with `category_source=llm`, a confidence, and `categorized_at`
**And** only anonymized descriptions (no account holder name/number) are sent to the provider
**And** on LLM failure the job retries then falls back to `other` without blocking ingestion.

## Story 2.2: Merchant normalization & cache

As a user,
I want raw merchant strings cleaned up and reused,
So that my data is readable and categorization is cheap.

**Acceptance Criteria:**

**Given** a raw description like "TIM HORTONS #1234 VANCOUVER BC"
**When** it is normalized
**Then** `merchant_name` becomes "Tim Hortons"
**And** a normalized merchant already categorized hits the merchant cache (`category_source=merchant_cache`) instead of the LLM.

## Story 2.3: Category override & correction learning

As a user,
I want to correct a wrong category,
So that future similar transactions are right.

**Acceptance Criteria:**

**Given** a categorized transaction
**When** I override its category
**Then** the row updates with `category_source=user` and the override seeds the merchant cache
**And** subsequent transactions for that merchant use the user-confirmed category.

## Story 2.4: LLM-as-judge validation

As the system,
I want categorization output validated,
So that low-quality LLM results are caught.

**Acceptance Criteria:**

**Given** an LLM categorization result
**When** the judge check runs
**Then** results outside the allowed category set or below a confidence threshold are flagged for fallback/re-try
**And** judge disagreements are logged for review.
