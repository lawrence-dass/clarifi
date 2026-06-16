# Starter Template Evaluation

## Primary Technology Domain
Full-stack web + async worker tier + AI/data pipeline.

## Starter Options Considered
- **create-next-app** — frontend only; doesn't address the worker tier or shared domain package.
- **T3 Stack** — opinionated Next.js + tRPC + Prisma, but single-app; fights the required web/API/worker separation and the Express + BullMQ worker tier.
- **Turborepo starter** — viable monorepo base, but adds Turbo's build orchestration we don't yet need.
- **Hand-rolled pnpm workspace** — selected.

## Selected Approach: Hand-rolled pnpm monorepo
**Rationale:** The architecture mandates a long-running worker tier (BullMQ, outbox, async anomaly explanation) that serverless/single-app starters don't accommodate. A hand-rolled pnpm workspace keeps the web/API/worker split explicit and the shared domain model (Prisma + Zod) in one package — matching the system design exactly, with no starter cruft to fight.

## Verified Stack (versions confirmed live, June 2026)
- **Runtime:** Node 22.17.1 (LTS; >=20.19 required by Prisma 7)
- **Web:** Next.js 16.2.9 (Turbopack default), React 19, Tailwind 3
- **API:** Express 4 + TypeScript, tsx (dev)
- **ORM:** Prisma 7.8.0 — new `prisma-client` generator (Rust-free), `PrismaPg` driver adapter, config-based datasource
- **DB/Cache:** PostgreSQL (Supabase), Redis + BullMQ (Upstash)
- **Validation:** Zod (shared schemas, incl. the NL-query IR)

## Structure
apps/web (Next.js) · apps/api (Express + workers) · packages/shared (Prisma 7 client, Zod, types)

**Note:** Project initialization is already complete (Epic 1 scaffold) — this documents the realized foundation rather than a future command.
