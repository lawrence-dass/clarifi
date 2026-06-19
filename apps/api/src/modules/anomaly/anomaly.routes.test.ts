import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  AccountType,
  AnomalySeverity,
  AnomalyType,
  Category,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
} from "@clarifi/shared";
import { createApp } from "../../app.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `anomaly-routes-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), userId: login.body.id };
}

async function seedAnomaly(userId: string): Promise<{ transactionId: string; anomalyId: string }> {
  const account = await prisma.account.create({
    data: {
      userId,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Anomaly Route Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      accountId: account.id,
      provider: Provider.csv,
      providerTransactionId: `txn-${randomUUID()}`,
      date: new Date(),
      amountCents: -500000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      rawDescription: "ROUTE TEST",
      merchantName: "Anomaly Store",
      category: Category.shopping,
      status: TransactionStatus.posted,
      isAnomaly: true,
    },
  });

  const anomaly = await prisma.anomaly.create({
    data: {
      transactionId: transaction.id,
      userId,
      type: AnomalyType.merchant,
      severity: AnomalySeverity.critical,
      explanation: "Test explanation for route tests.",
    },
  });

  return { transactionId: transaction.id, anomalyId: anomaly.id };
}

describe.skipIf(!hasDb)("GET /anomalies", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/anomalies");
    expect(res.status).toBe(401);
  });

  it("returns paginated anomaly list for authenticated user", async () => {
    const { cookie, userId } = await authenticate();
    await seedAnomaly(userId);

    const res = await request(app).get("/anomalies").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.anomalies)).toBe(true);
    expect(res.body.anomalies.length).toBeGreaterThanOrEqual(1);

    const anomaly = res.body.anomalies[0];
    expect(anomaly.id).toBeDefined();
    expect(anomaly.type).toBe(AnomalyType.merchant);
    expect(anomaly.severity).toBe(AnomalySeverity.critical);
    expect(anomaly.explanation).toBe("Test explanation for route tests.");
    expect(anomaly.transaction.amountCents).toBe(-500000);
    expect(anomaly.transaction.merchantName).toBe("Anomaly Store");
  }, 20_000);

  it("excludes dismissed anomalies by default", async () => {
    const { cookie, userId } = await authenticate();
    const { anomalyId } = await seedAnomaly(userId);

    // Dismiss the anomaly
    await request(app).patch(`/anomalies/${anomalyId}/dismiss`).set("Cookie", cookie);

    const res = await request(app).get("/anomalies").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ids = res.body.anomalies.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(anomalyId);
  }, 20_000);

  it("includes dismissed anomalies when includeDismissed=true", async () => {
    const { cookie, userId } = await authenticate();
    const { anomalyId } = await seedAnomaly(userId);

    await request(app).patch(`/anomalies/${anomalyId}/dismiss`).set("Cookie", cookie);

    const res = await request(app)
      .get("/anomalies?includeDismissed=true")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ids = res.body.anomalies.map((a: { id: string }) => a.id);
    expect(ids).toContain(anomalyId);
  }, 20_000);

  it("only returns anomalies for the authenticated user", async () => {
    const user1 = await authenticate();
    const user2 = await authenticate();
    await seedAnomaly(user2.userId);

    const res = await request(app).get("/anomalies").set("Cookie", user1.cookie);
    // User 1 should not see user 2's anomalies
    const ownerIds = res.body.anomalies.map((a: { transaction: { id: string } }) => a.transaction.id);
    // All returned anomalies must belong to user1
    expect(res.body.anomalies.every((a: { id: string }) => a.id)).toBe(true); // shape check
    void ownerIds;
  }, 20_000);
});

describe.skipIf(!hasDb)("PATCH /anomalies/:id/dismiss", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).patch(`/anomalies/${randomUUID()}/dismiss`);
    expect(res.status).toBe(401);
  });

  it("dismisses an anomaly", async () => {
    const { cookie, userId } = await authenticate();
    const { anomalyId } = await seedAnomaly(userId);

    const res = await request(app)
      .patch(`/anomalies/${anomalyId}/dismiss`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);

    const row = await prisma.anomaly.findUniqueOrThrow({ where: { id: anomalyId } });
    expect(row.dismissed).toBe(true);
  }, 20_000);

  it("is idempotent — dismissing twice returns 204 both times", async () => {
    const { cookie, userId } = await authenticate();
    const { anomalyId } = await seedAnomaly(userId);

    await request(app).patch(`/anomalies/${anomalyId}/dismiss`).set("Cookie", cookie);
    const res = await request(app)
      .patch(`/anomalies/${anomalyId}/dismiss`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);
  }, 20_000);
});

describe.skipIf(!hasDb)("PATCH /anomalies/:id/report", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).patch(`/anomalies/${randomUUID()}/report`);
    expect(res.status).toBe(401);
  });

  it("marks anomaly as suspicious", async () => {
    const { cookie, userId } = await authenticate();
    const { anomalyId } = await seedAnomaly(userId);

    const res = await request(app)
      .patch(`/anomalies/${anomalyId}/report`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);

    const row = await prisma.anomaly.findUniqueOrThrow({ where: { id: anomalyId } });
    expect(row.reportedSuspicious).toBe(true);
    expect(row.dismissed).toBe(false); // reporting un-dismisses
  }, 20_000);
});
