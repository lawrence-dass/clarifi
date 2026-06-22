import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma } from "@clarifi/shared";

// Avoid Redis on the categorize enqueue.
const mocks = vi.hoisted(() => ({ requestCategorization: vi.fn(async () => undefined) }));
vi.mock("../../queues/categorize.outbox.js", () => ({
  requestCategorization: mocks.requestCategorization,
}));

import { createApp } from "../../app.js";
import { plaidAdapter } from "../../lib/plaid-adapter.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const app = createApp();
const demoUserIds: string[] = [];
const normalEmails: string[] = [];

beforeEach(() => {
  // Keep the route hermetic: force the Plaid Sandbox seed to fail fast so the
  // demo is CSV-only (no network). The provisioning path must still succeed.
  vi.spyOn(plaidAdapter, "createSandboxPublicToken").mockRejectedValue(new Error("no plaid in test"));
});

afterAll(async () => {
  if (demoUserIds.length) await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
  if (normalEmails.length) await prisma.user.deleteMany({ where: { email: { in: normalEmails } } });
  await prisma.$disconnect();
  vi.restoreAllMocks();
});

function cookiesFrom(res: request.Response): string[] {
  const set = res.headers["set-cookie"];
  return Array.isArray(set) ? set : set ? [set] : [];
}
function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!hasDb)("POST /demo/session (Story 12.1)", () => {
  it("provisions a demo user, sets httpOnly auth cookies, and returns isDemo:true (AC1, AC5)", async () => {
    const res = await request(app).post("/demo/session");
    expect(res.status).toBe(201);
    demoUserIds.push(res.body.id as string);

    expect(res.body).toMatchObject({ isDemo: true });
    expect(res.body.email).toMatch(/^demo\+[0-9a-f-]{36}@demo\.clarifi\.local$/);
    expect(res.body).not.toHaveProperty("passwordHash");

    const cookies = cookiesFrom(res);
    expect(cookies.some((c) => c.startsWith("access_token=") && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith("refresh_token=") && /HttpOnly/i.test(c))).toBe(true);
  });

  it("drops the visitor into an authenticated session — /auth/me returns the demo user (AC1)", async () => {
    const session = await request(app).post("/demo/session");
    demoUserIds.push(session.body.id as string);
    const cookie = cookieHeader(cookiesFrom(session));

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: session.body.id, isDemo: true });
  });

  it("marks real (non-demo) users isDemo:false on /auth/me", async () => {
    const email = `demo-route-${randomUUID()}@example.test`;
    normalEmails.push(email);
    await request(app).post("/auth/register").send({ email, password: "correct-horse-battery", consent: true });
    const login = await request(app).post("/auth/login").send({ email, password: "correct-horse-battery" });
    const cookie = cookieHeader(cookiesFrom(login));

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.isDemo).toBe(false);
  });
});
