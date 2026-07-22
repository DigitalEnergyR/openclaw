import { describe, expect, it } from "vitest";
import { addDays, assertIsoDate, daysBetween, isIsoDate } from "./dates.ts";

describe("date helpers", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-07-25")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("July 25")).toBe(false);
    expect(isIsoDate("2026-7-5")).toBe(false);
  });

  it("assertIsoDate throws with a helpful label", () => {
    expect(() => assertIsoDate("nope", "start date")).toThrow(/Invalid start date/);
    expect(() => assertIsoDate("2026-07-25")).not.toThrow();
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-07-25", 2)).toBe("2026-07-27");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("computes days between", () => {
    expect(daysBetween("2026-08-01", "2026-08-05")).toBe(4);
    expect(daysBetween("2026-08-05", "2026-08-01")).toBe(-4);
  });
});
