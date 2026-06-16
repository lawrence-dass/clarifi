import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma, TransactionDirection } from "@clarifi/shared";
import { createApp } from "../../app.js";

const mocks = vi.hoisted(() => ({
  requestCategorization: vi.fn(async () => undefined),
}));

vi.mock("../../queues/categorize.outbox.js", () => ({
  requestCategorization: mocks.requestCategorization,
}));

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const app = createApp();
const emails: string[] = [];

/** Register + login; returns the auth cookie header and the user id. */
async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `csv-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), userId: login.body.id };
}

const SAMPLE_CSV = [
  "Date,Description,Amount",
  "2026-06-01,COFFEE,-4.50",
  "2026-13-99,BAD DATE,5.00", // malformed → reported, not imported
  "2026-06-02,PAYROLL,2000.00",
].join("\n");

const EXTENDED_CSV = [
  "Date,Description,Amount",
  "2026-06-01,COFFEE,-4.50",
  "2026-13-99,BAD DATE,5.00", // malformed → reported on every upload
  "2026-06-02,PAYROLL,2000.00",
  "2026-06-03,GROCERY,-25.25",
].join("\n");

function importCsv(cookie: string, csv = SAMPLE_CSV, institution = "Test Bank") {
  return request(app)
    .post("/transactions/import")
    .set("Cookie", cookie)
    .field("bankFormat", "generic")
    .field("institution", institution)
    .attach("file", Buffer.from(csv), "statement.csv");
}

describe.skipIf(!hasDb)("POST /transactions/import (e2e)", () => {
  afterAll(async () => {
    if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("imports valid rows as signed cents, reports the malformed row (AC #1-#4)", async () => {
    const { cookie } = await authenticate();
    const res = await importCsv(cookie);

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.duplicatesSkipped).toBe(0);
    expect(res.body.malformed).toHaveLength(1);
    expect(res.body.malformed[0].row).toBe(2);

    // Persisted with signed cents + derived direction + currency.
    const rows = await prisma.transaction.findMany({ where: { accountId: res.body.accountId } });
    expect(rows).toHaveLength(2);
    const coffee = rows.find((r) => r.rawDescription === "COFFEE");
    expect(coffee?.amountCents).toBe(-450n);
    expect(coffee?.direction).toBe(TransactionDirection.debit);
    expect(coffee?.currency).toBe("CAD");
    const payroll = rows.find((r) => r.rawDescription === "PAYROLL");
    expect(payroll?.amountCents).toBe(200000n);
    expect(payroll?.direction).toBe(TransactionDirection.credit);
    expect(mocks.requestCategorization).toHaveBeenCalledWith({
      userId: expect.any(String),
      accountId: res.body.accountId,
    });
  });

  it("re-uploading the same statement adds no duplicates (AC #4)", async () => {
    const { cookie } = await authenticate();
    const first = await importCsv(cookie);
    expect(first.body.imported).toBe(2);

    const second = await importCsv(cookie);
    expect(second.status).toBe(200);
    expect(second.body.imported).toBe(0);
    expect(second.body.duplicatesSkipped).toBe(2);
    expect(second.body.accountId).toBe(first.body.accountId); // same stable csv account

    const rows = await prisma.transaction.count({ where: { accountId: first.body.accountId } });
    expect(rows).toBe(2);
  });

  it("partial re-upload inserts only genuinely new rows and preserves malformed reporting (Story 1.5)", async () => {
    const { cookie } = await authenticate();
    const first = await importCsv(cookie);
    expect(first.body.imported).toBe(2);

    const second = await importCsv(cookie, EXTENDED_CSV);
    expect(second.status).toBe(200);
    expect(second.body.imported).toBe(1);
    expect(second.body.duplicatesSkipped).toBe(2);
    expect(second.body.malformed).toHaveLength(1);
    expect(second.body.malformed[0].row).toBe(2);

    const rows = await prisma.transaction.findMany({
      where: { accountId: first.body.accountId },
      orderBy: { date: "asc" },
    });
    expect(rows).toHaveLength(3);
    const grocery = rows.find((r) => r.rawDescription === "GROCERY");
    expect(grocery?.amountCents).toBe(-2525n);
    expect(grocery?.direction).toBe(TransactionDirection.debit);
    expect(grocery?.currency).toBe("CAD");
  });

  it("normalizes institution label variants for the same csv account (Story 1.5)", async () => {
    const { cookie } = await authenticate();
    const first = await importCsv(cookie, SAMPLE_CSV, "Test Bank");
    expect(first.body.imported).toBe(2);

    const second = await importCsv(cookie, SAMPLE_CSV, " test   bank ");
    expect(second.status).toBe(200);
    expect(second.body.imported).toBe(0);
    expect(second.body.duplicatesSkipped).toBe(2);
    expect(second.body.accountId).toBe(first.body.accountId);
  });

  it("scopes duplicate detection per user/account (Story 1.5)", async () => {
    const firstUser = await authenticate();
    const secondUser = await authenticate();

    const first = await importCsv(firstUser.cookie);
    const second = await importCsv(secondUser.cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.imported).toBe(2);
    expect(second.body.imported).toBe(2);
    expect(first.body.duplicatesSkipped).toBe(0);
    expect(second.body.duplicatesSkipped).toBe(0);
    expect(second.body.accountId).not.toBe(first.body.accountId);

    const firstRows = await prisma.transaction.count({ where: { accountId: first.body.accountId } });
    const secondRows = await prisma.transaction.count({ where: { accountId: second.body.accountId } });
    expect(firstRows).toBe(2);
    expect(secondRows).toBe(2);
  });

  it("rejects a non-CSV file (AC #5)", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("bankFormat", "generic")
      .field("institution", "Test Bank")
      .attach("file", Buffer.from("not a csv"), "notes.txt");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
  });

  it("rejects an oversized CSV with 413 (AC #5)", async () => {
    const { cookie } = await authenticate();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, "a");
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("bankFormat", "generic")
      .field("institution", "Test Bank")
      .attach("file", oversized, "statement.csv");

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("requires authentication", async () => {
    const res = await importCsv("");
    expect(res.status).toBe(401);
  });
});
