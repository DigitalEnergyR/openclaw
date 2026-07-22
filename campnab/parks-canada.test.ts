import { describe, expect, it, vi } from "vitest";
import { type FetchLike, localizedName, ParksCanadaClient } from "./parks-canada.ts";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("ParksCanadaClient.getMapAvailability", () => {
  it("sends the expected query params and returns parsed JSON", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return jsonResponse({
        mapId: -1,
        mapAvailabilities: [0],
        resourceAvailabilities: {},
        mapLinkAvailabilities: {},
      });
    };
    const client = new ParksCanadaClient({ fetchImpl });
    const res = await client.getMapAvailability({
      mapId: -2147483128,
      startDate: "2026-07-25",
      endDate: "2026-07-27",
      equipmentCategoryId: -32768,
      subEquipmentCategoryId: -32763,
      partySize: 2,
    });
    expect(res.mapId).toBe(-1);
    const url = calls[0];
    expect(url).toContain("/availability/map?");
    expect(url).toContain("mapId=-2147483128");
    expect(url).toContain("startDate=2026-07-25");
    expect(url).toContain("endDate=2026-07-27");
    expect(url).toContain("subEquipmentCategoryId=-32763");
    expect(url).toContain("getDailyAvailability=true");
  });
});

describe("ParksCanadaClient retry behavior", () => {
  it("retries on 5xx then succeeds", async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n++;
      return n < 3 ? jsonResponse({}, 503) : jsonResponse([{ equipmentCategoryId: -32768 }]);
    };
    const client = new ParksCanadaClient({ fetchImpl, sleep: async () => {} });
    const equip = await client.getEquipment();
    expect(n).toBe(3);
    expect(equip[0].equipmentCategoryId).toBe(-32768);
  });

  it("does not retry on 4xx and throws", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, 400));
    const client = new ParksCanadaClient({ fetchImpl, sleep: async () => {} });
    await expect(client.getEquipment()).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, 500));
    const client = new ParksCanadaClient({ fetchImpl, retries: 2, sleep: async () => {} });
    await expect(client.getEquipment()).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("counts requests", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse([]);
    const client = new ParksCanadaClient({ fetchImpl });
    await client.getEquipment();
    await client.getRootMaps();
    expect(client.requestCount).toBe(2);
  });
});

describe("localizedName", () => {
  it("prefers en-CA and falls back to title then first", () => {
    expect(localizedName([{ cultureName: "fr-CA", name: "Tente" }, { cultureName: "en-CA", name: "Tent" }])).toBe("Tent");
    expect(localizedName([{ cultureName: "en-CA", title: "Townsite" }])).toBe("Townsite");
    expect(localizedName([{ cultureName: "de-DE", name: "Zelt" }])).toBe("Zelt");
    expect(localizedName([])).toBe("");
    expect(localizedName(undefined)).toBe("");
  });
});
