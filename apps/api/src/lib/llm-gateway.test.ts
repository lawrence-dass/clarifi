import { describe, expect, it } from "vitest";
import { Category } from "@clarifi/shared";
import {
  buildCategorizationPrompt,
  buildJudgePrompt,
  categorizeBatch,
  judgeCategorizations,
  maxTokensForBatch,
} from "./llm-gateway.js";

describe("llm-gateway", () => {
  it("maps valid structured output", async () => {
    const client = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [{ id: "item_1", category: Category.food_and_dining, confidence: 0.7 }],
          },
        }),
      },
    };

    await expect(
      categorizeBatch([{ id: "tx1", description: "COFFEE" }], client),
    ).resolves.toEqual([{ id: "tx1", category: Category.food_and_dining, confidence: 0.7 }]);
  });

  it("rejects out-of-enum categories before returning to callers", async () => {
    const client = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [{ id: "item_1", category: "not_a_category", confidence: 0.8 }],
          },
        }),
      },
    };

    await expect(categorizeBatch([{ id: "tx1", description: "COFFEE" }], client)).rejects.toBeTruthy();
  });

  it("rejects out-of-range confidence before returning to callers", async () => {
    const client = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [{ id: "item_1", category: Category.food_and_dining, confidence: 42 }],
          },
        }),
      },
    };

    await expect(categorizeBatch([{ id: "tx1", description: "COFFEE" }], client)).rejects.toBeTruthy();
  });

  it("sends anonymized descriptions in the prompt", () => {
    const prompt = buildCategorizationPrompt([
      { id: "tx1", description: "CARD 4111 1111 1111 1111 JANE DOE", holderName: "Jane Doe" },
    ]);

    expect(prompt).toContain("[ACCOUNT]");
    expect(prompt).toContain("[NAME]");
    expect(prompt).not.toContain("tx1");
    expect(prompt).not.toContain("4111 1111 1111 1111");
    expect(prompt).not.toContain("JANE DOE");
  });

  it("rejects missing or duplicate LLM results", async () => {
    const missingClient = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [{ id: "item_1", category: Category.food_and_dining, confidence: 0.8 }],
          },
        }),
      },
    };
    const duplicateClient = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [
              { id: "item_1", category: Category.food_and_dining, confidence: 0.8 },
              { id: "item_1", category: Category.shopping, confidence: 0.6 },
            ],
          },
        }),
      },
    };

    const inputs = [
      { id: "tx1", description: "COFFEE" },
      { id: "tx2", description: "GROCERY" },
    ];
    await expect(categorizeBatch(inputs, missingClient)).rejects.toThrow(/result count/i);
    await expect(categorizeBatch(inputs, duplicateClient)).rejects.toThrow(/duplicate/i);
  });

  it("does not send internal transaction ids to the model", () => {
    const prompt = buildCategorizationPrompt([
      { id: "tx-internal-123", description: "COFFEE" },
    ]);

    expect(prompt).toContain("item_1");
    expect(prompt).not.toContain("tx-internal-123");
  });

  it("scales token budget with batch size", () => {
    expect(maxTokensForBatch(1)).toBe(1_000);
    expect(maxTokensForBatch(100)).toBeGreaterThanOrEqual(6_000);
  });

  it("maps judge verdicts back from aliases", async () => {
    const client = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [
              { id: "item_1", agree: false, suggestedCategory: Category.shopping, confidence: 0.74 },
            ],
          },
        }),
      },
    };

    await expect(
      judgeCategorizations([
        {
          id: "tx1",
          description: "COFFEE SHOP",
          proposedCategory: Category.food_and_dining,
        },
      ], client),
    ).resolves.toEqual([
      {
        id: "tx1",
        agree: false,
        suggestedCategory: Category.shopping,
        confidence: 0.74,
      },
    ]);
  });

  it("sends only anonymized descriptions and aliases to the judge", () => {
    const prompt = buildJudgePrompt([
      {
        id: "internal-tx-1",
        description: "CARD 4111 1111 1111 1111 JANE DOE",
        holderName: "Jane Doe",
        proposedCategory: Category.shopping,
      },
    ]);

    expect(prompt).toContain("item_1");
    expect(prompt).toContain("[ACCOUNT]");
    expect(prompt).toContain("[NAME]");
    expect(prompt).toContain(Category.shopping);
    expect(prompt).not.toContain("internal-tx-1");
    expect(prompt).not.toContain("4111 1111 1111 1111");
    expect(prompt).not.toContain("JANE DOE");
  });

  it("rejects missing or duplicate judge results", async () => {
    const missingClient = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [{ id: "item_1", agree: true, confidence: 0.8 }],
          },
        }),
      },
    };
    const duplicateClient = {
      messages: {
        parse: async () => ({
          parsed_output: {
            results: [
              { id: "item_1", agree: true, confidence: 0.8 },
              { id: "item_1", agree: false, suggestedCategory: Category.other, confidence: 0.8 },
            ],
          },
        }),
      },
    };

    const inputs = [
      { id: "tx1", description: "COFFEE", proposedCategory: Category.food_and_dining },
      { id: "tx2", description: "GROCERY", proposedCategory: Category.shopping },
    ];
    await expect(judgeCategorizations(inputs, missingClient)).rejects.toThrow(/result count/i);
    await expect(judgeCategorizations(inputs, duplicateClient)).rejects.toThrow(/duplicate/i);
  });
});
