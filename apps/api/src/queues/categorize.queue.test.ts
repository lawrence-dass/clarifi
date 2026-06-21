import { describe, expect, it } from "vitest";
import { redisConfigError } from "./categorize.queue.js";

describe("redisConfigError", () => {
  it("flags a missing REDIS_URL", () => {
    expect(redisConfigError(undefined)).toMatch(/not set/i);
    expect(redisConfigError("")).toMatch(/not set/i);
  });

  it("flags the .env.example placeholder", () => {
    expect(redisConfigError("rediss://default:token@dummy-host.upstash.io:6379")).toMatch(
      /placeholder|dummy-host/i,
    );
  });

  it("accepts a real-looking TCP connection string", () => {
    expect(redisConfigError("rediss://default:s3cret@apt-cat-12345.upstash.io:6379")).toBeNull();
    expect(redisConfigError("redis://localhost:6379")).toBeNull();
  });
});
