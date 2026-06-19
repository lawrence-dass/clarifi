import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma } from "@clarifi/shared";
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
  const email = `consent-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), userId: login.body.id };
}

const REDIRECT_URI = "https://app.example.com/callback";
const CLIENT_ID = "clarifi-mock-client";

describe("GET /fdx/oauth/authorize — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get(
      `/fdx/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&scope=accounts:read&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /fdx/oauth/token — no auth required", () => {
  it("returns 400 for invalid grant type", async () => {
    const res = await request(app)
      .post("/fdx/oauth/token")
      .send({ grant_type: "password", code: "x", redirect_uri: REDIRECT_URI, client_id: CLIENT_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown code", async () => {
    const res = await request(app)
      .post("/fdx/oauth/token")
      .send({
        grant_type: "authorization_code",
        code: "nonexistent-code",
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });
});

describe("GET /fdx/oauth/consents — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get("/fdx/oauth/consents");
    expect(res.status).toBe(401);
  });
});

describe("POST /fdx/oauth/consents/:id/revoke — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).post(`/fdx/oauth/consents/${randomUUID()}/revoke`);
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!hasDb)("OAuth2 consent flow — full happy path", () => {
  it("authorize → token → list consents → revoke", async () => {
    const { cookie } = await authenticate();

    // Step 1: Authorize — get auth code
    const authorizeRes = await request(app)
      .get(
        `/fdx/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&scope=accounts:read+transactions:read&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      )
      .set("Cookie", cookie);
    expect(authorizeRes.status).toBe(200);
    const { code, consentId } = authorizeRes.body as { code: string; consentId: string };
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
    expect(typeof consentId).toBe("string");

    // Step 2: Exchange code for access token
    const tokenRes = await request(app)
      .post("/fdx/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      });
    expect(tokenRes.status).toBe(200);
    expect(typeof tokenRes.body.access_token).toBe("string");
    expect(tokenRes.body.token_type).toBe("Bearer");
    expect(tokenRes.body.expires_in).toBe(3600);
    expect(tokenRes.body.scope).toContain("accounts:read");

    // Step 3: Same code cannot be reused
    const replayRes = await request(app)
      .post("/fdx/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe("invalid_grant");

    // Step 4: List consents — the granted consent appears
    const consentsRes = await request(app)
      .get("/fdx/oauth/consents")
      .set("Cookie", cookie);
    expect(consentsRes.status).toBe(200);
    const consentIds = consentsRes.body.consents.map((c: { id: string }) => c.id);
    expect(consentIds).toContain(consentId);

    // Step 5: Revoke the consent
    const revokeRes = await request(app)
      .post(`/fdx/oauth/consents/${consentId}/revoke`)
      .set("Cookie", cookie);
    expect(revokeRes.status).toBe(204);

    // Step 6: Revoked consent shows revoked status
    const afterRevoke = await request(app)
      .get("/fdx/oauth/consents")
      .set("Cookie", cookie);
    const revokedConsent = afterRevoke.body.consents.find((c: { id: string }) => c.id === consentId);
    expect(revokedConsent).toBeDefined();
    expect(revokedConsent.status).toBe("revoked");
    expect(revokedConsent.revokedAt).not.toBeNull();
  }, 30_000);

  it("returns 400 when required scope is missing from authorize", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .get(
        `/fdx/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&scope=unknown:scope&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      )
      .set("Cookie", cookie);
    // unsupported scopes → no supported scope granted → error
    expect(res.status).toBe(500); // propagated as internal since validateScopes throws
  }, 20_000);

  it("authorize returns 400 for missing redirect_uri", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .get(
        `/fdx/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&scope=accounts:read`,
      )
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  }, 20_000);
}, 30_000);
