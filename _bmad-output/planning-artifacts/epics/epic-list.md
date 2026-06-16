# Epic List

## Epic 1: Foundation & Auth
Users can securely sign up, sign in, and get their transactions into the system via CSV upload. Establishes the data model, Prisma migration, and RLS enablement (the security bedrock).
**FRs covered:** FR1, FR2, FR3, FR6, FR7, FR8, FR32

## Epic 2: Smart Categorization
Every transaction is automatically categorized and merchant-normalized, and users can correct it so the system learns.
**FRs covered:** FR9, FR10, FR11, FR12

## Epic 3: Spending Dashboard
Users see where their money goes: category breakdown, trends, top merchants, income vs expenses, and budgets.
**FRs covered:** FR13, FR14, FR15, FR16, FR17

## Epic 4: Plaid & Reliable Ingestion
Users connect real bank accounts (Plaid sandbox) with reliable, exactly-once webhook sync.
**FRs covered:** FR4, FR5

## Epic 5: Anomaly Detection
Users get early warning on unusual spending, explained in plain English, and can teach the system.
**FRs covered:** FR18, FR19, FR20, FR21, FR22, FR23, FR24

## Epic 6: Natural Language Query
Users ask questions about their finances in plain English and get safe, accurate answers.
**FRs covered:** FR25, FR26, FR27

## Epic 7: FDX & Open Banking
Users experience the Canadian open-banking consent model (grant/scope/revoke) via the FDX simulation.
**FRs covered:** FR31

## Epic 8: Notifications, Observability & Polish
Users stay informed (anomaly/budget alerts, weekly digest); the system is observable and production-credible.
**FRs covered:** FR28, FR29, FR30
