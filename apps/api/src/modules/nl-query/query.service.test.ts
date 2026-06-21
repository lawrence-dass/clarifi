import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../lib/app-error.js";

vi.mock("./ir-generator.js", () => ({ generateQueryIR: vi.fn() }));
vi.mock("./executor.js", () => ({ executeQueryIR: vi.fn() }));

const { generateQueryIR } = await import("./ir-generator.js");
const { executeQueryIR } = await import("./executor.js");
const mockedGenerate = vi.mocked(generateQueryIR);
const mockedExecute = vi.mocked(executeQueryIR);

const { runNLQuery } = await import("./query.service.js");

describe("runNLQuery", () => {
  afterEach(() => vi.clearAllMocks());

  it("maps an LLM / IR-generation failure to a 503 (not a raw 500)", async () => {
    mockedGenerate.mockRejectedValue(new Error("anthropic 401 — no api key"));

    const err = await runNLQuery("user-1", { question: "what did I spend?" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ httpStatus: 503, code: "LLM_UNAVAILABLE" });
    // The deterministic execute step is never reached when the LLM step fails.
    expect(mockedExecute).not.toHaveBeenCalled();
  });

  it("returns the shaped response when the LLM and executor succeed", async () => {
    mockedGenerate.mockResolvedValue({
      metric: "total_spend",
      dimensions: ["category"],
      interpretation: "Total spend by category.",
    } as unknown as Awaited<ReturnType<typeof generateQueryIR>>);
    mockedExecute.mockResolvedValue({
      rows: [{ category: "food_and_dining", value: 5000 }],
      interpretation: "Total spend by category.",
    });

    const res = await runNLQuery("user-1", { question: "spend by category", today: "2026-06-21" });

    expect(res).toEqual({
      interpretation: "Total spend by category.",
      rows: [{ category: "food_and_dining", value: 5000 }],
      metric: "total_spend",
      dimensions: ["category"],
    });
  });
});
