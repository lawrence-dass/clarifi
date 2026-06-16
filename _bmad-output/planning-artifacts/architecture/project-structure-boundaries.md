# Project Structure & Boundaries

## Complete Project Directory Structure

```
clarifi/
├── package.json                 # workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .nvmrc                        # 22
├── .gitignore  .env.example  CLAUDE.md  README.md
├── .github/workflows/ci.yml      # typecheck + test + build on PR
├── apps/
│   ├── web/                      # Next.js 16 (App Router, Turbopack)
│   │   ├── next.config.mjs  tailwind.config.ts  postcss.config.mjs  tsconfig.json
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx  page.tsx  globals.css
│   │       │   ├── (auth)/sign-in/  (auth)/sign-up/
│   │       │   ├── dashboard/         # spending dashboard
│   │       │   ├── anomalies/         # anomaly feed
│   │       │   ├── query/             # NL chat interface
│   │       │   └── settings/consent/  # FDX consent dashboard
│   │       ├── components/{ui,features}/
│   │       ├── lib/{api-client,query-client,utils}.ts
│   │       └── stores/               # Zustand (one per domain)
│   └── api/                      # Express + workers
│       ├── tsconfig.json
│       └── src/
│           ├── server.ts  app.ts  config.ts
│           ├── modules/             # route -> controller -> service -> repository
│           │   ├── auth/  accounts/  transactions/  categorization/
│           │   ├── anomalies/  query/  fdx/  budgets/  notifications/  webhooks/
│           ├── middleware/{auth,error,rate-limit}.ts
│           ├── queues/              # BullMQ queue definitions
│           ├── workers/             # categorize, anomaly-explain, outbox-dispatch
│           ├── lib/{llm-gateway,crypto,plaid-adapter}.ts
│           └── observability/otel.ts
└── packages/
    └── shared/                  # @clarifi/shared
        ├── prisma.config.ts
        ├── prisma/{schema.prisma, migrations/}
        └── src/{index,prisma,money,nl-query-ir}.ts + generated/  (gitignored)
```

## Architectural Boundaries
- **API boundary:** web calls api over REST with httpOnly cookies; api is the only tier with DB credentials and provider secrets.
- **Tenancy boundary:** all user-data access flows through `withUserContext()` (RLS); the DB is the enforcement point.
- **AI boundary:** the LLM gateway (`lib/llm-gateway`) is the only egress to Claude/OpenAI; it sends anonymized data and its output is always Zod-validated. The LLM has no DB or SQL authority.
- **Sync/async boundary:** HTTP handlers do fast work + enqueue; `workers/` own all slow/LLM work via BullMQ. Webhook handlers ack immediately after enqueue.
- **Provider boundary:** `lib/plaid-adapter` + `modules/fdx` map external shapes into the canonical model (anti-corruption layer).

## Requirements -> Structure Mapping (by epic)
- Epic 1 Foundation & Auth -> `packages/shared/prisma`, `apps/api/src/modules/auth`, `apps/web/src/app/(auth)`
- Epic 2 Categorization -> `modules/categorization` + `workers/categorize` + Redis merchant cache
- Epic 3 Dashboard -> `apps/web/src/app/dashboard` + `modules/transactions` (per-currency aggregations)
- Epic 4 Plaid + Ingestion -> `modules/accounts`, `modules/webhooks`, `lib/plaid-adapter`, `workers/outbox-dispatch`
- Epic 5 Anomaly -> `modules/anomalies`, `workers/anomaly-explain`, stats engine in `lib/`
- Epic 6 NL Query -> `modules/query` (IR compiler + AST validator) + `apps/web/src/app/query`
- Epic 7 FDX -> `modules/fdx` (mock server + consent OAuth2) + `apps/web/src/app/settings/consent`
- Epic 8 Notifications/Observability -> `modules/notifications`, `observability/otel`, `.github/workflows`

## Data Flow
Ingestion: Plaid webhook -> `modules/webhooks` (verify, enqueue, ack) -> `workers` (sync via cursor, idempotent upsert) -> categorize + anomaly jobs -> DB. Read: web -> api (RLS query) -> JSON. NL query: web -> `modules/query` (LLM->IR->validated SQL under RLS) -> result + interpretation.
