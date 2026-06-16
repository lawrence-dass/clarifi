import { z } from "zod";

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
  // Access-token JWT signing secret — required (auth depends on it). Min 32
  // chars so a weak/placeholder value can't reach production.
  JWT_ACCESS_SECRET: z.string().min(32),
  // Token lifetimes. Validated to the exact grammar durationToSeconds accepts
  // (positive integer + s/m/h/d) so a value only one parser would accept can't
  // reach runtime and crash login. There is no separate JWT_REFRESH_SECRET:
  // refresh tokens are opaque random values stored SHA-256-hashed, not JWTs.
  ACCESS_TOKEN_TTL: z.string().regex(/^[1-9]\d*[smhd]$/, 'must be e.g. "15m", "2h", "7d"').default("15m"),
  REFRESH_TOKEN_TTL: z.string().regex(/^[1-9]\d*[smhd]$/, 'must be e.g. "15m", "2h", "7d"').default("7d"),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
