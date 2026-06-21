# Sample data — CSV statements for testing upload

Sample bank-statement CSVs for exercising the **Upload transactions** page
(`/dashboard/upload` → `POST /transactions/import`).

## Files

| File | Format | Notes |
|------|--------|-------|
| `sample-statement-generic.csv` | **Generic** | `Date,Description,Amount` · ISO dates (`YYYY-MM-DD`) · signed amounts (outflow negative, inflow positive) · CAD. |

## How to use

1. Sign in, go to **Upload** in the nav.
2. **CSV file:** choose `sample-statement-generic.csv`.
3. **Bank format:** `Generic CSV`.
4. **Institution:** any label, e.g. `Sample Bank`.
5. **Import transactions.** You should see e.g. *"Imported 31 transactions."*
6. Open **Dashboard** — the category breakdown, trend, cash-flow summary, and
   budgets now reflect the imported data.

## What the sample covers (and why)

- **Two months (May + June 2026)** — so the current-month view (June) has data
  *and* the month-over-month category deltas have a prior month to compare against.
- **Biweekly income** — `Payroll Deposit` on the 1st and 15th (positive = inflow).
- **Recurring subscriptions** — Netflix, Spotify across both months (tests merchant
  normalization + recurring detection).
- **A spread of categories** — groceries (Loblaws/Metro/Costco), dining
  (Tim Hortons/Starbucks/Uber Eats), transport (Petro-Canada/Presto), housing
  (Rent), utilities (Hydro/Rogers), shopping (Amazon/Shoppers), etc.
- **A positive refund** — `Refund - Amazon.ca` (inflow that isn't income).
- **A person-to-person e-transfer** — `INTERAC e-Transfer to Jordan P` (the
  normalizer strips the person's name; no PII reaches the merchant cache).
- **A large outlier** — `The Brick - Furniture, -2399.00` — well above typical
  spend, to make anomaly detection interesting.

## Idempotency

Re-uploading the **same file** imports **0 new** transactions and reports the rest
as *duplicates skipped* — the ingestion idempotency guarantee
(`(account_id, provider_transaction_id)`). Try uploading twice to see it.

> All amounts are CAD and already signed from the customer's view (outflow
> negative, inflow positive), matching the `generic` profile in
> `apps/api/src/modules/ingestion/bank-profiles.ts`.
