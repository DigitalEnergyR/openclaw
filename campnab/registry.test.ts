import { describe, expect, it } from "vitest";
import {
  buildBookingUrl,
  FRONTCOUNTRY_CATEGORY,
  INSTANCES,
  resolveEquipment,
  resolveInstance,
  resolvePark,
} from "./registry.ts";

const parksCanada = INSTANCES["parks-canada"];
const bcParks = INSTANCES["bc-parks"];

describe("resolveInstance", () => {
  it("resolves known instances and is case-insensitive", () => {
    expect(resolveInstance("parks-canada").apiBaseUrl).toBe("https://reservation.pc.gc.ca/api");
    expect(resolveInstance("BC-Parks").apiBaseUrl).toBe("https://camping.bcparks.ca/api");
  });
  it("throws on unknown instance", () => {
    expect(() => resolveInstance("alberta")).toThrow(/Unknown instance/);
  });
});

describe("resolveEquipment", () => {
  it("resolves canonical keys per instance", () => {
    expect(resolveEquipment(parksCanada, "rv-21")).toEqual({
      id: -32763,
      categoryId: FRONTCOUNTRY_CATEGORY,
      label: "Trailer or Motorhome up to 21ft",
    });
    // Same numeric id means something different on BC Parks - resolve by instance.
    expect(resolveEquipment(bcParks, "rv-32")).toEqual({
      id: -32763,
      categoryId: FRONTCOUNTRY_CATEGORY,
      label: "Trailer or RV up to 32ft",
    });
  });

  it("resolves synonyms and is case-insensitive, per instance", () => {
    expect(resolveEquipment(parksCanada, "RV").id).toBe(-32761); // rv -> rv-27
    expect(resolveEquipment(parksCanada, " tent ").id).toBe(-32767); // tent -> medium-tent
    expect(resolveEquipment(bcParks, "rv").id).toBe(-32763); // rv -> rv-32
    expect(resolveEquipment(bcParks, "tent").id).toBe(-32768); // tent -> tent-1
  });

  it("throws when an alias is not valid for the instance", () => {
    // rv-21 exists on Parks Canada but not on BC Parks.
    expect(() => resolveEquipment(bcParks, "rv-21")).toThrow(/Unknown equipment/);
    expect(() => resolveEquipment(parksCanada, "spaceship")).toThrow(/Unknown equipment/);
  });
});

describe("resolvePark", () => {
  it("resolves known parks with their instance", () => {
    expect(resolvePark("waterton-townsite").instance).toBe("parks-canada");
    expect(resolvePark("moyie-lake")).toMatchObject({ instance: "bc-parks", mapId: -2147483473 });
    expect(resolvePark("mabel-lake")).toMatchObject({ instance: "bc-parks", mapId: -2147483506 });
  });
  it("throws on unknown park", () => {
    expect(() => resolvePark("narnia")).toThrow(/Unknown park/);
  });
});

describe("buildBookingUrl", () => {
  it("builds a results link on the instance's booking host", () => {
    const url = buildBookingUrl({
      bookingHost: "https://camping.bcparks.ca",
      resourceLocationId: -2147483565,
      mapId: -2147483473,
      startDate: "2026-08-05",
      endDate: "2026-08-07",
      nights: 2,
      equipmentCategoryId: -32768,
      subEquipmentCategoryId: -32763,
      partySize: 2,
    });
    expect(url.startsWith("https://camping.bcparks.ca/create-booking/results?")).toBe(true);
    expect(url).toContain("mapId=-2147483473");
    expect(url).toContain("resourceLocationId=-2147483565");
    expect(url).toContain("nights=2");
    expect(url).toContain("subEquipmentId=-32763");
  });
});
