/**
 * Static lookup tables and the booking deep-link builder.
 *
 * Several park systems run the same white-labelled "GoingToCamp" reservation
 * backend, so one client speaks to all of them - only the base URL, the park
 * map ids, and the equipment catalog differ. Each system is modelled here as an
 * "instance". Equipment ids come from GET /api/equipment on that instance and
 * are NOT portable between instances: on Parks Canada -32763 is "RV up to 21ft",
 * on BC Parks -32763 is "Trailer or RV up to 32ft". Always resolve equipment
 * against the instance the park belongs to.
 *
 * `subEquipmentCategoryId` selects the rig/tent size and materially changes
 * which sites match (a big RV fits fewer sites than a small tent). All ids
 * below were verified against the live API.
 */

export interface EquipmentOption {
  id: number;
  categoryId: number;
  label: string;
}

/** Frontcountry equipment category id (shared across instances). */
export const FRONTCOUNTRY_CATEGORY = -32768;
/** Backcountry equipment category id. */
export const BACKCOUNTRY_CATEGORY = -32767;

export interface GoingToCampInstance {
  id: string;
  label: string;
  /** API base, e.g. https://reservation.pc.gc.ca/api */
  apiBaseUrl: string;
  /** Host for booking deep-links, no trailing slash. */
  bookingHost: string;
  /** Canonical equipment options for this instance. */
  equipment: Record<string, EquipmentOption>;
  /** Friendly synonyms -> canonical equipment key, for this instance. */
  equipmentSynonyms: Record<string, string>;
}

function frontcountry(entries: Array<[string, number, string]>): Record<string, EquipmentOption> {
  const out: Record<string, EquipmentOption> = {};
  for (const [key, id, label] of entries) {
    out[key] = { id, categoryId: FRONTCOUNTRY_CATEGORY, label };
  }
  return out;
}

const PARKS_CANADA_EQUIPMENT = frontcountry([
  ["small-tent", -32768, "Small Tent"],
  ["medium-tent", -32767, "Medium Tent"],
  ["large-tent", -32766, "Large Tent"],
  ["van", -32765, "Van/Pickup"],
  ["tent-trailer", -32764, "Tent Trailer"],
  ["rv-21", -32763, "Trailer or Motorhome up to 21ft"],
  ["rv-24", -32762, "Trailer or Motorhome up to 24ft"],
  ["rv-27", -32761, "Trailer or Motorhome up to 27ft"],
  ["rv-35", -32760, "Trailer or Motorhome up to 35ft"],
  ["rv-35-plus", -32759, "Trailer or Motorhome over 35ft"],
]);

const BC_PARKS_EQUIPMENT = frontcountry([
  ["tent-1", -32768, "1 Tent"],
  ["tent-2", -32767, "2 Tents"],
  ["tent-3", -32766, "3 Tents"],
  ["van", -32765, "Van/Camper"],
  ["trailer-18", -32764, "Trailer up to 18ft"],
  ["rv-32", -32763, "Trailer or RV up to 32ft"],
  ["rv-32-plus", -32762, "Trailer or RV over 32ft"],
]);

export const INSTANCES: Record<string, GoingToCampInstance> = {
  "parks-canada": {
    id: "parks-canada",
    label: "Parks Canada",
    apiBaseUrl: "https://reservation.pc.gc.ca/api",
    bookingHost: "https://reservation.pc.gc.ca",
    equipment: PARKS_CANADA_EQUIPMENT,
    // "tent"/"rv" resolve to a broad middle option that most sites accept.
    equipmentSynonyms: {
      tent: "medium-tent",
      rv: "rv-27",
      motorhome: "rv-27",
      trailer: "rv-27",
      camper: "van",
      pickup: "van",
    },
  },
  "bc-parks": {
    id: "bc-parks",
    label: "BC Parks",
    apiBaseUrl: "https://camping.bcparks.ca/api",
    bookingHost: "https://camping.bcparks.ca",
    equipment: BC_PARKS_EQUIPMENT,
    equipmentSynonyms: {
      tent: "tent-1",
      rv: "rv-32",
      motorhome: "rv-32",
      trailer: "rv-32",
      camper: "van",
      pickup: "van",
    },
  },
};

export const DEFAULT_INSTANCE = "parks-canada";

export function resolveInstance(id: string): GoingToCampInstance {
  const inst = INSTANCES[id.trim().toLowerCase()];
  if (!inst) {
    throw new Error(`Unknown instance "${id}". Known: ${Object.keys(INSTANCES).join(", ")}.`);
  }
  return inst;
}

export function resolveEquipment(instance: GoingToCampInstance, alias: string): EquipmentOption {
  const key = alias.trim().toLowerCase();
  const canonical = instance.equipmentSynonyms[key] ?? key;
  const option = instance.equipment[canonical];
  if (!option) {
    throw new Error(
      `Unknown equipment "${alias}" for ${instance.label}. Known: ${Object.keys(instance.equipment).join(", ")} (aliases: ${Object.keys(instance.equipmentSynonyms).join(", ")}).`,
    );
  }
  return option;
}

export interface ParkEntry {
  /** Which GoingToCamp instance this park lives on. */
  instance: string;
  mapId: number;
  resourceLocationId: number;
  label: string;
}

/** A few known campgrounds. Use `--map <id>` / `--list-parks` for the rest. */
export const PARKS: Record<string, ParkEntry> = {
  "waterton-townsite": {
    instance: "parks-canada",
    mapId: -2147483128,
    resourceLocationId: -2147483542,
    label: "Waterton Lakes - Townsite Campground",
  },
  "moyie-lake": {
    instance: "bc-parks",
    mapId: -2147483473,
    resourceLocationId: -2147483565,
    label: "Moyie Lake Provincial Park",
  },
  "mabel-lake": {
    instance: "bc-parks",
    mapId: -2147483506,
    resourceLocationId: -2147483580,
    label: "Mabel Lake Provincial Park",
  },
};

export function resolvePark(alias: string): ParkEntry {
  const key = alias.trim().toLowerCase();
  const entry = PARKS[key];
  if (!entry) {
    throw new Error(
      `Unknown park "${alias}". Known: ${Object.keys(PARKS).join(", ")}. Use --map <id> or --list-parks.`,
    );
  }
  return entry;
}

export interface BookingUrlParams {
  /** Booking host for the park's instance, no trailing slash. */
  bookingHost: string;
  resourceLocationId: number;
  mapId: number;
  startDate: string;
  /** Check-out date, YYYY-MM-DD. */
  endDate: string;
  nights: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId: number;
  partySize?: number;
}

/** Build a link that opens the booking site's results view for these criteria. */
export function buildBookingUrl(params: BookingUrlParams): string {
  const q = new URLSearchParams({
    resourceLocationId: String(params.resourceLocationId),
    mapId: String(params.mapId),
    searchTabGroupId: "0",
    bookingCategoryId: "0",
    startDate: params.startDate,
    endDate: params.endDate,
    nights: String(params.nights),
    isReserving: "true",
    equipmentId: String(params.equipmentCategoryId),
    subEquipmentId: String(params.subEquipmentCategoryId),
    partySize: String(params.partySize ?? 2),
    searchTime: `${params.startDate}T00:00:00.000`,
  });
  return `${params.bookingHost}/create-booking/results?${q.toString()}`;
}
