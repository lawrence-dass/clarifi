# 1. Product Overview

## What is Clarifi?

Clarifi turns your bank transactions into actionable insights. It automatically categorizes transactions, detects unusual spending patterns, and lets you query your own financial data in plain English.

Most banking apps show you a list of transactions. They don't tell you anything useful about them. Clarifi does three things they don't:

1. **Understands your spending** — automatically categorizes transactions and surfaces patterns over time
2. **Detects anomalies** — flags unusual transactions based on your personal spending history, not generic rules, and explains why in plain English
3. **Answers questions** — natural language interface to query your own financial data ("how much did I spend on food last month compared to the month before?")

## Primary User

Canadians who want clarity on where their money is going and early warning when something looks wrong.

## Why this exists

Canada is rolling out open banking under the federal **Consumer-Driven Banking** framework (the *Consumer-Driven Banking Act*, overseen by the Financial Consumer Agency of Canada / FCAC). That framework is the **regulatory layer**; the **Financial Data Exchange (FDX)** standard is the leading **technical API specification** it aligns to — REST resources, OAuth2 consent, JSON schemas. Clarifi is built with that future in mind: it supports both Plaid (available now) and a simulated FDX API layer, structured as a provider-agnostic adapter so a real Consumer-Driven Banking connection can be added without touching the core. This makes Clarifi compatible with where Canadian fintech is heading.

> Note: Canadian open banking is moving quickly. Verify FCAC's designated technical standard and the current rollout status before public-facing claims — this section reflects the landscape as understood at time of writing.

---
