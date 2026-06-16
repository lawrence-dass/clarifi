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

// Single top-level cleanup for every e2e describe below (deleting the user
// cascades to its refresh_tokens). Disconnect once at the very end.
afterAll(async () => {
  if (emails.length) {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  }
  await prisma.$disconnect();
});

// Helpers for cookie-based flows.
async function registerAndLogin(email: string, password = "correct-horse-battery") {
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const res = await request(app).post("/auth/login").send({ email, password });
  return res;
}
function cookiesFrom(res: request.Response): string[] {
  const set = res.headers["set-cookie"];
  return Array.isArray(set) ? set : set ? [set] : [];
}
function cookieHeader(setCookies: string[]): string {
  // Reduce "name=value; Path=...; HttpOnly" entries to a "name=value; ..." request header.
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!hasDb)("POST /auth/register (e2e)", () => {
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

describe.skipIf(!hasDb)("login / refresh / logout / me (e2e)", () => {
  it("logs in with valid credentials, sets httpOnly cookies, returns the user (AC #1)", async () => {
    const email = uniqueEmail();
    const res = await registerAndLogin(email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email });
    expect(res.body).not.toHaveProperty("passwordHash");
    const cookies = cookiesFrom(res);
    expect(cookies.some((c) => c.startsWith("access_token=") && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith("refresh_token=") && /HttpOnly/i.test(c))).toBe(true);
  });

  it("returns an IDENTICAL generic 401 for wrong password and wrong email (AC #4)", async () => {
    const email = uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: "correct-horse-battery", consent: true });

    const wrongPw = await request(app).post("/auth/login").send({ email, password: "wrong-password-x" });
    const wrongEmail = await request(app)
      .post("/auth/login")
      .send({ email: uniqueEmail(), password: "correct-horse-battery" });

    expect(wrongPw.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    // Byte-identical body — no signal about which field was wrong.
    expect(wrongPw.body).toEqual(wrongEmail.body);
    expect(wrongPw.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("GET /auth/me returns the user with a valid access cookie, 401 without (AC #5)", async () => {
    const email = uniqueEmail();
    const login = await registerAndLogin(email);
    const cookie = cookieHeader(cookiesFrom(login));

    const ok = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe(email);

    const anon = await request(app).get("/auth/me");
    expect(anon.status).toBe(401);
  });

  it("sets SameSite=Strict on both cookies and Path=/auth on the refresh cookie (AC #1)", async () => {
    const email = uniqueEmail();
    const res = await registerAndLogin(email);
    const access = cookiesFrom(res).find((c) => c.startsWith("access_token="));
    const refresh = cookiesFrom(res).find((c) => c.startsWith("refresh_token="));
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(/SameSite=Strict/i.test(access!)).toBe(true);
    expect(/SameSite=Strict/i.test(refresh!)).toBe(true);
    // Refresh cookie is path-scoped to /auth; access cookie is site-wide.
    expect(/;\s*Path=\/auth/i.test(refresh!)).toBe(true);
    expect(/;\s*Path=\/(;|$|\s)/i.test(access!)).toBe(true);
  });

  it("rotates the refresh token and rejects the OLD one afterward (AC #2)", async () => {
    const email = uniqueEmail();
    const login = await registerAndLogin(email);
    const oldRefresh = cookieHeader(cookiesFrom(login).filter((c) => c.startsWith("refresh_token=")));

    const rotated = await request(app).post("/auth/refresh").set("Cookie", oldRefresh);
    expect(rotated.status).toBe(200);
    const newRefresh = cookieHeader(cookiesFrom(rotated).filter((c) => c.startsWith("refresh_token=")));
    expect(newRefresh).not.toBe(oldRefresh); // a fresh token was issued

    // The OLD token is now invalid — replaying it is detected as reuse (401).
    const replayOld = await request(app).post("/auth/refresh").set("Cookie", oldRefresh);
    expect(replayOld.status).toBe(401);
  });

  it("is atomic under concurrent refresh of the same token — exactly one wins (AC #3)", async () => {
    const email = uniqueEmail();
    const login = await registerAndLogin(email);
    const refreshCookie = cookieHeader(cookiesFrom(login).filter((c) => c.startsWith("refresh_token=")));

    // Fire two refreshes with the SAME token simultaneously. The conditional
    // revoke must let exactly one rotate (200) and reject the other (401) —
    // never two 200s (which would fork the family and defeat reuse detection).
    const [a, b] = await Promise.all([
      request(app).post("/auth/refresh").set("Cookie", refreshCookie),
      request(app).post("/auth/refresh").set("Cookie", refreshCookie),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it("detects refresh-token reuse and revokes the family (AC #3)", async () => {
    const email = uniqueEmail();
    const login = await registerAndLogin(email);
    const tokenA = cookieHeader(cookiesFrom(login).filter((c) => c.startsWith("refresh_token=")));

    // Rotate A → B (A is now revoked).
    const rotated = await request(app).post("/auth/refresh").set("Cookie", tokenA);
    const tokenB = cookieHeader(cookiesFrom(rotated).filter((c) => c.startsWith("refresh_token=")));

    // Replaying the revoked A → 401 reuse, and the whole family (incl. B) is revoked.
    const reuse = await request(app).post("/auth/refresh").set("Cookie", tokenA);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSE");

    const afterReuse = await request(app).post("/auth/refresh").set("Cookie", tokenB);
    expect(afterReuse.status).toBe(401); // B was revoked by the family sweep
  });

  it("logout revokes the refresh token and clears cookies (AC #5)", async () => {
    const email = uniqueEmail();
    const login = await registerAndLogin(email);
    const refresh = cookieHeader(cookiesFrom(login).filter((c) => c.startsWith("refresh_token=")));

    const out = await request(app).post("/auth/logout").set("Cookie", refresh);
    expect(out.status).toBe(204);

    // The revoked token can no longer refresh.
    expect((await request(app).post("/auth/refresh").set("Cookie", refresh)).status).toBe(401);
  });
});
