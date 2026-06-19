import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { AnomalyType, Category } from "@clarifi/shared";
import { config } from "../config.js";
import { anonymizeDescription } from "./anonymize.js";
import {
  CATEGORIZATION_JUDGE_SYSTEM_PROMPT,
  CATEGORIZATION_SYSTEM_PROMPT,
} from "../modules/categorization/categorization.prompt.js";

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
const JudgeVerdictSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      agree: z.boolean(),
      suggestedCategory: CategorySchema.optional(),
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

export interface JudgeInput {
  id: string;
  description: string;
  holderName?: string | null;
  proposedCategory: Category;
}

export interface JudgeVerdict {
  id: string;
  agree: boolean;
  suggestedCategory?: Category;
  confidence: number;
}

export interface AnthropicLike {
  messages: {
    parse(params: unknown): Promise<{ parsed_output: unknown }>;
  };
}

/**
 * Generic structured-output call. Centralizes the Anthropic SDK + zodOutputFormat
 * here so feature modules (e.g. NL→IR generation) never import the SDK directly —
 * this gateway is the single LLM egress point (guardrail). Callers pass a zod v4
 * schema; the raw parsed output is returned for the caller to validate against the
 * authoritative shared schema.
 */
export async function parseStructured(
  params: {
    model: string;
    maxTokens: number;
    system: string;
    user: string;
    schema: Parameters<typeof zodOutputFormat>[0];
  },
  client: AnthropicLike = createAnthropicClient(),
): Promise<unknown> {
  const response = await client.messages.parse({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
    output_config: { format: zodOutputFormat(params.schema) },
  });
  return response.parsed_output;
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

export async function judgeCategorizations(
  items: JudgeInput[],
  client: AnthropicLike = createAnthropicClient(),
): Promise<JudgeVerdict[]> {
  if (items.length === 0) return [];

  const response = await client.messages.parse({
    model: config.CATEGORIZE_JUDGE_MODEL,
    max_tokens: maxTokensForBatch(items.length),
    system: CATEGORIZATION_JUDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildJudgePrompt(items) }],
    output_config: { format: zodOutputFormat(JudgeVerdictSchema) },
  });

  const parsed = JudgeVerdictSchema.parse(response.parsed_output);
  return mapAndValidateJudgeVerdicts(items, parsed.results);
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

export function buildJudgePrompt(items: JudgeInput[]): string {
  return JSON.stringify({
    categories: Object.values(Category),
    transactions: items.map((item, index) => ({
      id: toAlias(index),
      description: anonymizeDescription(item.description, { holderName: item.holderName }),
      proposedCategory: item.proposedCategory,
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

function mapAndValidateJudgeVerdicts(
  items: JudgeInput[],
  results: z.infer<typeof JudgeVerdictSchema>["results"],
): JudgeVerdict[] {
  const aliases = new Map(items.map((item, index) => [toAlias(index), item.id]));
  const seen = new Set<string>();
  const mapped: JudgeVerdict[] = [];

  for (const result of results) {
    const originalId = aliases.get(result.id);
    if (!originalId) throw new Error(`LLM judge returned unknown transaction alias: ${result.id}`);
    if (seen.has(result.id)) throw new Error(`LLM judge returned duplicate transaction alias: ${result.id}`);
    seen.add(result.id);
    mapped.push({
      id: originalId,
      agree: result.agree,
      suggestedCategory: result.suggestedCategory,
      confidence: result.confidence,
    });
  }

  if (seen.size !== items.length) {
    throw new Error("LLM judge result count did not match input count");
  }

  return mapped;
}

function toAlias(index: number): string {
  return `${RESULT_ALIAS_PREFIX}${index + 1}`;
}

export interface AnomalyExplainInput {
  type: AnomalyType;
  // dollar amounts (not cents) — no PII, only public merchant names
  amountDollars: number;
  merchantName: string | null;
  category: string | null;
  // context specific to the anomaly type
  velocityCount?: number;
  velocityWindowMinutes?: number;
  priorTransactionCount?: number;
  typicalAmountDollars?: number;
}

const ExplanationSchema = z.object({ explanation: z.string() });

export async function generateAnomalyExplanation(
  input: AnomalyExplainInput,
  client: AnthropicLike = createAnthropicClient(),
): Promise<string> {
  const contextLines: string[] = [];

  if (input.type === AnomalyType.velocity && input.velocityCount && input.velocityWindowMinutes) {
    contextLines.push(
      `There were ${input.velocityCount} charges at this merchant within ${input.velocityWindowMinutes} minutes.`,
    );
  } else if (input.type === AnomalyType.merchant) {
    contextLines.push(
      `This is your first transaction at this merchant (or one of your first ${input.priorTransactionCount ?? 0} transactions).`,
    );
    if (input.typicalAmountDollars !== undefined) {
      contextLines.push(
        `Your typical transaction size is $${input.typicalAmountDollars.toFixed(2)}.`,
      );
    }
  } else if (input.type === AnomalyType.amount && input.priorTransactionCount && input.typicalAmountDollars !== undefined) {
    contextLines.push(
      `You have made ${input.priorTransactionCount} transactions at this merchant with a typical amount of $${input.typicalAmountDollars.toFixed(2)}.`,
    );
  }

  const prompt = [
    `Anomaly type: ${input.type}`,
    `Merchant: ${input.merchantName ?? "Unknown"}`,
    `Amount: $${input.amountDollars.toFixed(2)} CAD`,
    input.category ? `Category: ${input.category}` : null,
    ...contextLines,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    "You are a personal finance assistant. Write a single concise sentence (max 25 words) explaining why a transaction was flagged as unusual. Be specific, helpful, and non-alarmist. Respond only with the explanation text.";

  const response = await client.messages.parse({
    model: config.ANOMALY_EXPLAIN_MODEL,
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(ExplanationSchema) },
  });

  const parsed = ExplanationSchema.parse(response.parsed_output);
  return parsed.explanation.trim();
}

function createAnthropicClient(): AnthropicLike {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for LLM categorization");
  }
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}
