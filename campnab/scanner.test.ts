import { describe, expect, it } from "vitest";
import {
  type FetchLike,
  type MapAvailabilityResponse,
  ParksCanadaClient,
} from "./parks-canada.ts";
import { checkInDates, newlyOpenedSites, scanCampground } from "./scanner.ts";

/** Build a fetch that serves canned map responses keyed by mapId. */
function mapFetch(byMapId: Record<number, MapAvailabilityResponse>): FetchLike {
  return async (url) => {
    const m = url.match(/mapId=(-?\d+)/);
    const mapId = m ? Number(m[1]) : NaN;
    const body = byMapId[mapId];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

function daily(codes: number[]) {
  return codes.map((availability) => ({ availability, remainingQuota: null }));
}

describe("scanCampground", () => {
  it("recurses parent -> child loops and counts only availability 0 as bookable", async () => {
    const fetchImpl = mapFetch({
      // parent map: no sites of its own, links to two loops
      [-100]: {
        mapId: -100,
        mapAvailabilities: [0],
        resourceAvailabilities: {},
        mapLinkAvailabilities: { "-101": [0], "-102": [0] },
      },
      // loop A: one whole-stay-open site, one booked, one closed
      [-101]: {
        mapId: -101,
        mapAvailabilities: [0],
        resourceAvailabilities: {
          "-201": daily([0, 0]), // open both nights
          "-202": daily([1, 1]), // booked
          "-203": daily([5, 5]), // unavailable
        },
        mapLinkAvailabilities: {},
      },
      // loop B: one partial (open first night only)
      [-102]: {
        mapId: -102,
        mapAvailabilities: [0],
        resourceAvailabilities: {
          "-204": daily([0, 1]), // partial
          "-205": daily([3, 4]), // blocked / wrong-equipment
        },
        mapLinkAvailabilities: {},
      },
    });
    const client = new ParksCanadaClient({ fetchImpl });
    const result = await scanCampground(client, {
      mapId: -100,
      start: "2026-08-01",
      nights: 2,
      equipmentCategoryId: -32768,
      subEquipmentCategoryId: -32763,
    });

    expect(result.totalSites).toBe(5);
    expect(result.apiCalls).toBe(3); // parent + 2 loops
    expect(result.wholeStaySites.map((s) => s.resourceId)).toEqual([-201]);
    expect(result.sitesWithOpenings.map((s) => s.resourceId).sort()).toEqual([-204, -201].sort());
    const partial = result.sitesWithOpenings.find((s) => s.resourceId === -204);
    expect(partial?.openNights).toBe(1);
    expect(partial?.openWholeStay).toBe(false);
  });

  it("guards against cycles in the map graph", async () => {
    const fetchImpl = mapFetch({
      [-1]: {
        mapId: -1,
        mapAvailabilities: [0],
        resourceAvailabilities: { "-9": daily([0]) },
        mapLinkAvailabilities: { "-2": [0] },
      },
      [-2]: {
        mapId: -2,
        mapAvailabilities: [0],
        resourceAvailabilities: {},
        mapLinkAvailabilities: { "-1": [0] }, // points back to -1
      },
    });
    const client = new ParksCanadaClient({ fetchImpl });
    const result = await scanCampground(client, {
      mapId: -1,
      start: "2026-08-01",
      nights: 1,
      equipmentCategoryId: -32768,
      subEquipmentCategoryId: -32768,
    });
    expect(result.apiCalls).toBe(2); // each map visited once
    expect(result.totalSites).toBe(1);
  });

  it("rejects invalid nights", async () => {
    const client = new ParksCanadaClient({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    await expect(
      scanCampground(client, {
        mapId: -1,
        start: "2026-08-01",
        nights: 0,
        equipmentCategoryId: -32768,
        subEquipmentCategoryId: -32768,
      }),
    ).rejects.toThrow(/nights/);
  });
});

describe("newlyOpenedSites", () => {
  const mk = (ids: number[]) => ({
    query: {} as never,
    totalSites: 0,
    sitesWithOpenings: [],
    apiCalls: 0,
    wholeStaySites: ids.map((resourceId) => ({ resourceId, nightly: [0], openNights: 1, openWholeStay: true })),
  });

  it("returns only sites not present in the previous scan", () => {
    expect(newlyOpenedSites(null, mk([1, 2]))).toEqual([1, 2]);
    expect(newlyOpenedSites(mk([1]), mk([1, 2]))).toEqual([2]);
    expect(newlyOpenedSites(mk([1, 2]), mk([1, 2]))).toEqual([]);
    expect(newlyOpenedSites(mk([1, 2]), mk([2]))).toEqual([]);
  });
});

describe("checkInDates", () => {
  it("yields each valid check-in leaving room for the stay", () => {
    expect([...checkInDates("2026-08-01", "2026-08-05", 2)]).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("yields nothing when the range is too short for the stay", () => {
    expect([...checkInDates("2026-08-01", "2026-08-02", 3)]).toEqual([]);
  });
});
