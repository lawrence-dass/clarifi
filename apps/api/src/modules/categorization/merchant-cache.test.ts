import { describe, expect, it } from "vitest";
import { Category } from "@clarifi/shared";
import { merchantCategoryCacheKey, parseCachedMerchantCategory } from "./merchant-cache.js";

describe("merchantCategoryCacheKey", () => {
  it("tenant-scopes normalized merchant keys", () => {
    expect(
      merchantCategoryCacheKey({
        userId: "user-1",
        merchantName: "Tim Hortons",
      }),
    ).toBe("merchant-category:user-1:tim-hortons");
  });

  it("does not include raw descriptions or internal transaction ids", () => {
    const key = merchantCategoryCacheKey({
      userId: "user-2",
      merchantName: "A&W",
    });

    expect(key).toBe("merchant-category:user-2:a-w");
    expect(key).not.toContain("tx_");
    expect(key).not.toContain("#1234");
    expect(key).not.toContain("VANCOUVER");
  });
});

describe("parseCachedMerchantCategory", () => {
  it("validates cached payloads and rejects malformed entries", () => {
    expect(parseCachedMerchantCategory(JSON.stringify({
      category: Category.food_and_dining,
      confidence: 0.9,
    }))).toEqual({ category: Category.food_and_dining, confidence: 0.9 });
    expect(parseCachedMerchantCategory("{not-json")).toBeNull();
    expect(parseCachedMerchantCategory(JSON.stringify({ category: "invalid", confidence: 0.9 }))).toBeNull();
    expect(parseCachedMerchantCategory(JSON.stringify({ category: Category.shopping, confidence: 2 }))).toBeNull();
  });
});
