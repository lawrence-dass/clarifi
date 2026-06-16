import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { Category } from "@clarifi/shared";
import { config } from "../config.js";
import { anonymizeDescription } from "./anonymize.js";
import { CATEGORIZATION_SYSTEM_PROMPT } from "../modules/categorization/categorization.prompt.js";

const CategorySchema = z.enum(Category);
const BatchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: CategorySchema,
      confidence: z.number().min(0).max(1),
    }),
  ),
});
const RESULT_ALIAS_PREFIX = "item_";

export interface CategorizeInput {
  id: string;
  description: string;
  holderName?: string | null;
}

export interface CategorizeResult {
  id: string;
  category: Category;
  confidence: number;
}

interface AnthropicLike {
  messages: {
    parse(params: unknown): Promise<{ parsed_output: unknown }>;
  };
}

export async function categorizeBatch(
  items: CategorizeInput[],
  client: AnthropicLike = createAnthropicClient(),
): Promise<CategorizeResult[]> {
  if (items.length === 0) return [];

  const response = await client.messages.parse({
    model: config.CATEGORIZATION_MODEL,
    max_tokens: maxTokensForBatch(items.length),
    system: CATEGORIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildCategorizationPrompt(items) }],
    output_config: { format: zodOutputFormat(BatchResultSchema) },
  });

  const parsed = BatchResultSchema.parse(response.parsed_output);
  return mapAndValidateResults(items, parsed.results);
}

export function buildCategorizationPrompt(items: CategorizeInput[]): string {
  return JSON.stringify({
    categories: Object.values(Category),
    transactions: items.map((item, index) => ({
      id: toAlias(index),
      description: anonymizeDescription(item.description, { holderName: item.holderName }),
    })),
  });
}

export function maxTokensForBatch(size: number): number {
  return Math.max(1_000, size * 60);
}

function mapAndValidateResults(
  items: CategorizeInput[],
  results: z.infer<typeof BatchResultSchema>["results"],
): CategorizeResult[] {
  const aliases = new Map(items.map((item, index) => [toAlias(index), item.id]));
  const seen = new Set<string>();
  const mapped: CategorizeResult[] = [];

  for (const result of results) {
    const originalId = aliases.get(result.id);
    if (!originalId) throw new Error(`LLM categorization returned unknown transaction alias: ${result.id}`);
    if (seen.has(result.id)) throw new Error(`LLM categorization returned duplicate transaction alias: ${result.id}`);
    seen.add(result.id);
    mapped.push({ id: originalId, category: result.category, confidence: result.confidence });
  }

  if (seen.size !== items.length) {
    throw new Error("LLM categorization result count did not match input count");
  }

  return mapped;
}

function toAlias(index: number): string {
  return `${RESULT_ALIAS_PREFIX}${index + 1}`;
}

function createAnthropicClient(): AnthropicLike {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for LLM categorization");
  }
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}
