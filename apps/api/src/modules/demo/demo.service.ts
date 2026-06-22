import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { DemoKind, prisma, withUserContext } from "@clarifi/shared";
import { serviceUnavailable } from "../../lib/app-error.js";
import { importCsv } from "../ingestion/ingestion.service.js";
import { exchangePlaidPublicToken } from "../accounts/accounts.service.js";
import { processPlaidSyncJob } from "../../workers/plaid-sync.worker.js";
import { plaidAdapter, type PlaidAdapter } from "../../lib/plaid-adapter.js";
import { DEMO_SEED_CSV } from "./seed-data/demo-statement.js";

/** A demo session lives for one hour; Story 12.2's reaper deletes it after. */
export const DEMO_TTL_MS = 60 * 60 * 1000;

const DEMO_INSTITUTION = "Clarifi Demo Bank";

export interface ProvisionDemoOptions {
  /** Which single source to seed — "csv" (CAD sample) or "plaid" (Sandbox). */
  kind: DemoKind;
  /**
   * Adapter used for the Plaid **Sandbox** seed (createSandboxPublicToken + the
   * sync). Defaults to the real singleton. Tests inject a fake; pair it with
   * `setPlaidAdapterForTests` so the reused `exchangePlaidPublicToken` resolves
   * the same fake.
   */
  plaidAdapter?: PlaidAdapter;
}

export interface ProvisionedDemoUser {
  id: string;
  email: string;
  consentedAt: Date;
  isDemo: true;
  demoKind: DemoKind;
}

/**
 * Provision a fresh anonymous demo user and seed it with realistic synthetic
 * data through the **canonical ingestion adapters** (Story 12.1), from the
 * **single source matching `kind`** (Story 12.3 — one flavor per demo, so the
 * experience stays coherent and currency-consistent).
 *
 * The user row is created with the base `prisma` client — the same sanctioned
 * pre-auth exception registration uses: there is no `app.current_user_id` yet,
 * and the users_insert RLS policy (migration 0004) permits an insert when none
 * is set. Every seeding step that follows runs under the user's RLS context via
 * the reused services, so a demo user's data is isolated from all other users,
 * including other concurrent demo visitors.
 *
 * Privacy (PIPEDA): a demo user holds synthetic data only (bundled sample CSV or
 * Plaid Sandbox), so there is no real personal information and no signup-consent
 * step is required. `demoExpiresAt` is written here for the 12.2 TTL reaper.
 */
export async function provisionDemoUser(
  options: ProvisionDemoOptions,
): Promise<ProvisionedDemoUser> {
  const { kind } = options;
  const adapter = options.plaidAdapter ?? plaidAdapter;

  // A valid argon2 PHC string over a random secret: keeps `password_hash` NOT
  // NULL without a login backdoor (no real password can ever verify against it,
  // and the synthetic email is unguessable).
  const passwordHash = await argon2.hash(randomBytes(32).toString("hex"));
  const now = Date.now();

  const user = await prisma.user.create({
    data: {
      email: `demo+${randomUUID()}@demo.clarifi.local`,
      passwordHash,
      consentedAt: new Date(now),
      isDemo: true,
      demoExpiresAt: new Date(now + DEMO_TTL_MS),
      demoKind: kind,
    },
    select: { id: true, email: true, consentedAt: true },
  });

  if (kind === DemoKind.csv) {
    // CSV seed. importCsv owns sign normalization, the idempotent
    // (account, providerTransactionId) upsert, and the categorize enqueue.
    await importCsv({
      userId: user.id,
      bankFormat: "generic",
      institution: DEMO_INSTITUTION,
      csv: DEMO_SEED_CSV,
    });
  } else {
    // Plaid demo seeds ONLY Plaid Sandbox — no CSV fallback, so the kind contract
    // stays honest. If Plaid can't seed, delete the just-created (empty) user so
    // we don't leave an orphan, and surface 503.
    const seeded = await seedPlaidSandbox(user.id, adapter).catch(() => false);
    if (!seeded) {
      await withUserContext(user.id, (tx) => tx.user.delete({ where: { id: user.id } })).catch(() => {});
      throw serviceUnavailable(
        "PLAID_DEMO_UNAVAILABLE",
        "The Plaid demo is temporarily unavailable — try the sample CSV demo.",
      );
    }
  }

  return { id: user.id, email: user.email, consentedAt: user.consentedAt, isDemo: true, demoKind: kind };
}

/**
 * Seed Plaid Sandbox synthetic transactions through the canonical Plaid pipeline
 * (no Link UI): mint a sandbox public token, reuse `exchangePlaidPublicToken`
 * (stores the encrypted item + accounts under RLS), then run the canonical sync
 * (idempotent upsert + sign normalization in the adapter + categorize enqueue).
 */
async function seedPlaidSandbox(userId: string, adapter: PlaidAdapter): Promise<boolean> {
  const publicToken = await adapter.createSandboxPublicToken();
  await exchangePlaidPublicToken({ userId, publicToken });

  // exchangePlaidPublicToken returns account summaries, not the provider item id
  // the sync keys on — read it back under the user's RLS context.
  const item = await withUserContext(userId, (tx) =>
    tx.plaidItem.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { itemId: true },
    }),
  );
  if (!item) return false;

  await processPlaidSyncJob({ itemId: item.itemId }, { adapter });
  return true;
}
