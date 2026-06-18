import { z } from "zod";

function decodeEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const raw = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return raw;
}

/**
 * Validate environment at boot — fail fast with a clear message rather than
 * discovering a missing secret deep in a request. Guardrail: validate all
 * external input (env included) at the boundary.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  // Access-token JWT signing secret — required (auth depends on it). Min 32
  // chars so a weak/placeholder value can't reach production.
  JWT_ACCESS_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  CATEGORIZATION_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  CATEGORIZE_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(25),
  // Optional second-pass judge. Kept off by default so cost/latency stay unchanged
  // unless explicitly enabled.
  CATEGORIZE_JUDGE_ENABLED: z
    .preprocess((value) => value === true || String(value).toLowerCase() === "true" || value === "1", z.boolean())
    .default(false),
  // Results below this confidence are treated as low quality and are not trusted
  // or seeded into the merchant cache.
  CATEGORIZE_JUDGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  // When the judge is enabled, only results below this ceiling get the extra
  // LLM check; high-confidence results avoid the additional cost.
  CATEGORIZE_JUDGE_REVIEW_CEILING: z.coerce.number().min(0).max(1).default(0.8),
  // Separate knob for judge model choice, defaulting to the categorization model
  // family used elsewhere for low-cost classification.
  CATEGORIZE_JUDGE_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  PLAID_CLIENT_ID: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  PLAID_SECRET: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  ENCRYPTION_KEY: z.string().min(1).transform(decodeEncryptionKey),
  // Token lifetimes. Validated to the exact grammar durationToSeconds accepts
  // (positive integer + s/m/h/d) so a value only one parser would accept can't
  // reach runtime and crash login. There is no separate JWT_REFRESH_SECRET:
  // refresh tokens are opaque random values stored SHA-256-hashed, not JWTs.
  ACCESS_TOKEN_TTL: z.string().regex(/^[1-9]\d*[smhd]$/, 'must be e.g. "15m", "2h", "7d"').default("15m"),
  REFRESH_TOKEN_TTL: z.string().regex(/^[1-9]\d*[smhd]$/, 'must be e.g. "15m", "2h", "7d"').default("7d"),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
