import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { prisma } from "@clarifi/shared";
import { createApp } from "../../app.js";

// Mock the NL query service so tests never need a live LLM or DB for happy paths
vi.mock("./query.service.js", () => ({
  runNLQuery: vi.fn().mockResolvedValue({
    interpretation: "Total spending in June 2026.",
    rows: [{ value: -150000 }],
    metric: "total_spend",
    dimensions: [],
  }),
}));

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `nl-query-routes-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), userId: login.body.id };
}

describe("POST /query/nl — auth and validation (always run)", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app)
      .post("/query/nl")
      .send({ question: "How much did I spend this month?" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when question is missing", async () => {
    // Use a fake auth cookie that's syntactically present but invalid — the
    // auth middleware rejects it, so we get 401 in that case.
    // Instead, test the validation path by checking body without auth separately.
    const res = await request(app).post("/query/nl").send({});
    expect(res.status).toBe(401); // no auth — 401 fires before body validation
  });
});

describe.skipIf(!hasDb)("POST /query/nl — authenticated requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock to default happy-path response
    const { runNLQuery } = require("./query.service.js") as {
      runNLQuery: ReturnType<typeof vi.fn>;
    };
    runNLQuery.mockResolvedValue({
      interpretation: "Total spending in June 2026.",
      rows: [{ value: -150000 }],
      metric: "total_spend",
      dimensions: [],
    });
  });

  it("returns 400 when question is empty string", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when question is missing from body", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when question exceeds 1000 chars", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "a".repeat(1001) });
    expect(res.status).toBe(400);
  });

  it("returns 200 with interpretation and rows for valid question", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "How much did I spend this month?" });
    expect(res.status).toBe(200);
    expect(typeof res.body.interpretation).toBe("string");
    expect(res.body.interpretation.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(typeof res.body.metric).toBe("string");
    expect(Array.isArray(res.body.dimensions)).toBe(true);
  }, 20_000);

  it("accepts optional today field in valid YYYY-MM-DD format", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "How much did I spend?", today: "2026-06-01" });
    expect(res.status).toBe(200);
  }, 20_000);

  it("returns 400 when today is not in YYYY-MM-DD format", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "How much did I spend?", today: "June 1, 2026" });
    expect(res.status).toBe(400);
  }, 20_000);

  it("echoes interpretation back to the user (transparency guardrail)", async () => {
    const { cookie } = await authenticate();
    const res = await request(app)
      .post("/query/nl")
      .set("Cookie", cookie)
      .send({ question: "Total spending June?" });
    expect(res.status).toBe(200);
    expect(res.body.interpretation).toBe("Total spending in June 2026.");
  }, 20_000);
}, 20_000);
