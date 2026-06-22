# 6. PIPEDA Compliance Notes

- Users explicitly consent to data processing on sign up
- Transaction data is never shared with third parties beyond Plaid
- Users can delete their account and all associated data
- No sensitive financial data (account numbers, SINs) is stored
- All API calls to LLM providers use anonymized transaction descriptions — no account holder name or account number sent to LLM
- **Public demo users (§11) are exempt from the signup-consent step because they hold synthetic data only** — sample CSV and Plaid Sandbox data are not a real person's financial information, so there is no personal information to consent over. Demo data is TTL-reaped end-to-end (1-hour lifetime), introducing no new PII surface or retention obligation.

---
