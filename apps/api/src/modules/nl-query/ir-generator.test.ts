import { describe, expect, it, vi } from "vitest";
import { generateQueryIR } from "./ir-generator.js";
import type { QueryIR } from "@clarifi/shared";

function makeMockClient(output: unknown) {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({ parsed_output: output }),
    },
  };
}

const TODAY = "2026-06-19";

const BASE_IR: QueryIR = {
  metric: "total_spend",
  dimensions: [],
  filters: [],
  timeRange: { start: "2026-06-01", end: "2026-06-19" },
  limit: 1,
  interpretation: "Total spending so far this month.",
};

describe("generateQueryIR", () => {
  it("returns a valid QueryIR for a scalar spend question", async () => {
    const client = makeMockClient(BASE_IR);
    const result = await generateQueryIR("How much did I spend this month?", TODAY, client);
    expect(result.metric).toBe("total_spend");
    expect(result.dimensions).toEqual([]);
    expect(result.timeRange.start).toBe("2026-06-01");
    expect(result.timeRange.end).toBe("2026-06-19");
    expect(result.limit).toBe(1);
    expect(typeof result.interpretation).toBe("string");
    expect(result.interpretation.length).toBeGreaterThan(0);
  });

  it("returns dimension query with limit 10 for ranked spend by category", async () => {
    const dimensionIR: QueryIR = {
      ...BASE_IR,
      metric: "total_spend",
      dimensions: ["category"],
      limit: 10,
      interpretation: "Total spending by category this month.",
    };
    const client = makeMockClient(dimensionIR);
    const result = await generateQueryIR("What did I spend by category this month?", TODAY, client);
    expect(result.dimensions).toEqual(["category"]);
    expect(result.limit).toBe(10);
  });

  it("returns merchant filter for specific-merchant question", async () => {
    const filteredIR: QueryIR = {
      ...BASE_IR,
      metric: "total_spend",
      filters: [{ field: "merchant", op: "eq", value: "Tim Hortons" }],
      interpretation: "Total spent at Tim Hortons this month.",
    };
    const client = makeMockClient(filteredIR);
    const result = await generateQueryIR("How much did I spend at Tim Hortons?", TODAY, client);
    expect(result.filters[0]!).toMatchObject({ field: "merchant", op: "eq", value: "Tim Hortons" });
  });

  it("returns transaction_count metric for count question", async () => {
    const countIR: QueryIR = {
      ...BASE_IR,
      metric: "transaction_count",
      limit: 1,
      interpretation: "Number of transactions this month.",
    };
    const client = makeMockClient(countIR);
    const result = await generateQueryIR("How many transactions did I have?", TODAY, client);
    expect(result.metric).toBe("transaction_count");
  });

  it("returns net metric for savings question", async () => {
    const netIR: QueryIR = {
      ...BASE_IR,
      metric: "net",
      interpretation: "Net income minus spending this month.",
    };
    const client = makeMockClient(netIR);
    const result = await generateQueryIR("What were my savings this month?", TODAY, client);
    expect(result.metric).toBe("net");
  });

  it("passes today and question in the message content", async () => {
    const client = makeMockClient(BASE_IR);
    await generateQueryIR("Test question?", TODAY, client);
    const callArgs = client.messages.parse.mock.calls[0]![0] as {
      messages: { content: string }[];
    };
    const userContent = callArgs.messages[0]!.content;
    expect(userContent).toContain(TODAY);
    expect(userContent).toContain("Test question?");
  });

  it("rejects invalid IR from the LLM (missing metric)", async () => {
    const badOutput = { dimensions: [], filters: [], timeRange: { start: "2026-06-01", end: "2026-06-19" }, limit: 1, interpretation: "bad" };
    const client = makeMockClient(badOutput);
    await expect(generateQueryIR("question", TODAY, client)).rejects.toThrow();
  });

  it("rejects IR with invalid metric value", async () => {
    const badOutput = { ...BASE_IR, metric: "unknown_metric" };
    const client = makeMockClient(badOutput);
    await expect(generateQueryIR("question", TODAY, client)).rejects.toThrow();
  });

  it("rejects IR with invalid timeRange format", async () => {
    const badOutput = { ...BASE_IR, timeRange: { start: "June 1", end: "June 19" } };
    const client = makeMockClient(badOutput);
    await expect(generateQueryIR("question", TODAY, client)).rejects.toThrow();
  });

  it("rejects IR with limit exceeding 1000", async () => {
    const badOutput = { ...BASE_IR, limit: 9999 };
    const client = makeMockClient(badOutput);
    await expect(generateQueryIR("question", TODAY, client)).rejects.toThrow();
  });

  it("accepts up to 2 dimensions", async () => {
    const multiDimIR: QueryIR = {
      ...BASE_IR,
      dimensions: ["category", "month"],
      limit: 10,
      interpretation: "Spending by category per month.",
    };
    const client = makeMockClient(multiDimIR);
    const result = await generateQueryIR("Spending by category per month?", TODAY, client);
    expect(result.dimensions).toEqual(["category", "month"]);
  });

  it("accepts in-filter with array of values", async () => {
    const inFilterIR: QueryIR = {
      ...BASE_IR,
      filters: [{ field: "category", op: "in", value: ["food_and_dining", "entertainment"] }],
      interpretation: "Spending on food and entertainment.",
    };
    const client = makeMockClient(inFilterIR);
    const result = await generateQueryIR("Spending on food and entertainment?", TODAY, client);
    expect(result.filters[0]!).toMatchObject({ field: "category", op: "in" });
    expect(Array.isArray(result.filters[0]!.value)).toBe(true);
  });
});
