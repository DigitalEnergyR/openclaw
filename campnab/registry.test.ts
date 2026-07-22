import { describe, expect, it } from "vitest";
import {
  buildBookingUrl,
  FRONTCOUNTRY_CATEGORY,
  resolveEquipment,
  resolvePark,
} from "./registry.ts";

describe("resolveEquipment", () => {
  it("resolves canonical keys", () => {
    expect(resolveEquipment("rv-21")).toEqual({
      id: -32763,
      categoryId: FRONTCOUNTRY_CATEGORY,
      label: "Trailer or Motorhome up to 21ft",
    });
  });

  it("resolves synonyms and is case-insensitive", () => {
    expect(resolveEquipment("RV").id).toBe(-32761); // rv -> rv-27
    expect(resolveEquipment(" tent ").id).toBe(-32767); // tent -> medium-tent
  });

  it("throws on unknown equipment", () => {
    expect(() => resolveEquipment("spaceship")).toThrow(/Unknown equipment/);
  });
});

describe("resolvePark", () => {
  it("resolves a known park", () => {
    expect(resolvePark("waterton-townsite").mapId).toBe(-2147483128);
  });
  it("throws on unknown park", () => {
    expect(() => resolvePark("narnia")).toThrow(/Unknown park/);
  });
});

describe("buildBookingUrl", () => {
  it("builds a reservation.pc.gc.ca results link with the search params", () => {
    const url = buildBookingUrl({
      resourceLocationId: -2147483542,
      mapId: -2147483128,
      startDate: "2026-09-05",
      endDate: "2026-09-07",
      nights: 2,
      equipmentCategoryId: -32768,
      subEquipmentCategoryId: -32763,
      partySize: 2,
    });
    expect(url.startsWith("https://reservation.pc.gc.ca/create-booking/results?")).toBe(true);
    expect(url).toContain("mapId=-2147483128");
    expect(url).toContain("resourceLocationId=-2147483542");
    expect(url).toContain("nights=2");
    expect(url).toContain("subEquipmentId=-32763");
  });
});
