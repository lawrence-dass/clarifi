import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma } from "@clarifi/shared";
import { createApp } from "../../app.js";

// End-to-end tests through the mounted Express app — exercises the full stack
// (router → controller → Zod → service → error middleware) over HTTP.
// DB-gated like the service/RLS suites.
const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const app = createApp();
const emails: string[] = [];
function uniqueEmail(): string {
  const e = `route-${randomUUID()}@example.test`;
  emails.push(e);
  return e;
}

describe.skipIf(!hasDb)("POST /auth/register (e2e)", () => {
  afterAll(async () => {
    if (emails.length) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    await prisma.$disconnect();
  });

  it("returns 201 with the bare resource and never the passwordHash (AC #1, #4)", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password: "correct-horse-battery", consent: true });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email, consentedAt: expect.any(String) });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).not.toHaveProperty("passwordHash");
    expect(res.body).not.toHaveProperty("password");
  });

  it("rejects consent:false with 400 and creates NO row (AC #3, #5)", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password: "correct-horse-battery", consent: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // The key assertion AC#5 requires: no user row was created.
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).toBeNull();
  });

  it("rejects a weak password with 400 and creates NO row (AC #3)", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password: "short", consent: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("returns 409 EMAIL_TAKEN on a duplicate registration (AC #3)", async () => {
    const email = uniqueEmail();
    const first = await request(app)
      .post("/auth/register")
      .send({ email, password: "correct-horse-battery", consent: true });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/auth/register")
      .send({ email, password: "another-valid-password", consent: true });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("maps a malformed JSON body to 400 (not 500)", async () => {
    const res = await request(app)
      .post("/auth/register")
      .set("Content-Type", "application/json")
      .send('{"email": "x@y.com", ');
    expect(res.status).toBe(400);
  });
});
