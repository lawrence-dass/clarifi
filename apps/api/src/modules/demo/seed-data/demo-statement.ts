/**
 * Bundled demo seed statement (Story 12.1).
 *
 * Inlined as a string constant so it ships in the production bundle — the API
 * must NOT read `docs/sample-data/...` at runtime (that path is not shipped).
 * Mirrors `docs/sample-data/sample-statement-generic.csv`. Synthetic data only.
 *
 * `generic` bank format: Date,Description,Amount with an already-signed amount
 * from the customer's view (outflow < 0, inflow > 0) — the CSV adapter applies
 * no further sign flip. Two known anchors used by tests:
 *   "Payroll Deposit - ACME Corp" 2450.00 → +245000 cents
 *   "Loblaws"                      -92.40  →   -9240 cents
 */
export const DEMO_SEED_CSV = `Date,Description,Amount
2026-05-01,Payroll Deposit - ACME Corp,2450.00
2026-05-03,Loblaws,-92.40
2026-05-05,Rent - Maple Property Mgmt,-1800.00
2026-05-07,Petro-Canada,-58.10
2026-05-09,Tim Hortons,-5.85
2026-05-12,Netflix,-20.99
2026-05-14,Hydro One,-110.32
2026-05-15,Payroll Deposit - ACME Corp,2450.00
2026-05-18,Metro,-67.25
2026-05-22,Spotify,-10.99
2026-05-25,Presto Transit,-30.00
2026-05-28,Amazon.ca,-44.99
2026-06-01,Payroll Deposit - ACME Corp,2450.00
2026-06-02,Loblaws,-84.23
2026-06-03,Tim Hortons,-6.45
2026-06-04,Petro-Canada,-61.40
2026-06-05,Rent - Maple Property Mgmt,-1800.00
2026-06-06,Rogers Communications,-95.00
2026-06-07,Netflix,-20.99
2026-06-08,Costco Wholesale,-213.77
2026-06-09,Refund - Amazon.ca,18.07
2026-06-10,INTERAC e-Transfer to Jordan P,-150.00
2026-06-11,LCBO,-39.95
2026-06-12,Spotify,-10.99
2026-06-13,Uber Eats,-34.20
2026-06-15,Payroll Deposit - ACME Corp,2450.00
2026-06-16,Shoppers Drug Mart,-27.66
2026-06-17,Presto Transit,-30.00
2026-06-18,The Brick - Furniture,-2399.00
2026-06-19,Metro,-78.50
2026-06-20,Starbucks,-7.15
`;
