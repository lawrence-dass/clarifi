import { describe, it, expect } from "vitest";
import { lastWeekRange } from "./digest.service.js";

describe("lastWeekRange", () => {
  it("returns last Monday–Sunday when today is Monday", () => {
    // 2026-06-15 is a Monday
    const today = new Date("2026-06-15T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.toISOString().slice(0, 10)).toBe("2026-06-08");
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("returns last Monday–Sunday when today is Sunday", () => {
    // 2026-06-14 is a Sunday
    const today = new Date("2026-06-14T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.toISOString().slice(0, 10)).toBe("2026-06-08");
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("returns last Monday–Sunday when today is Wednesday", () => {
    // 2026-06-17 is a Wednesday
    const today = new Date("2026-06-17T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.toISOString().slice(0, 10)).toBe("2026-06-08");
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("returns last Monday–Sunday when today is Saturday", () => {
    // 2026-06-13 is a Saturday; this week started June 8 (Mon), so last week is June 1–June 7
    const today = new Date("2026-06-13T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-07");
  });

  it("correctly spans a month boundary", () => {
    // 2026-07-01 is a Wednesday; last week is June 22–June 28
    const today = new Date("2026-07-01T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-28");
  });

  it("start is midnight and end is 23:59:59.999 local (UTC 0)", () => {
    const today = new Date("2026-06-17T00:00:00Z");
    const { start, end } = lastWeekRange(today);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
  });

  it("week span is exactly 6 days apart (Monday to Sunday)", () => {
    const today = new Date("2026-06-19T12:00:00Z");
    const { start, end } = lastWeekRange(today);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });
});
