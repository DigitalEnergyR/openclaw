/**
 * Static lookup tables and the booking deep-link builder.
 *
 * Equipment IDs come from GET /api/equipment. Frontcountry equipment lives
 * under category -32768; backcountry under -32767. `subEquipmentCategoryId`
 * selects the rig/tent size and materially changes which sites match (a big
 * RV fits fewer sites than a small tent).
 *
 * The park table is intentionally small - any campground is reachable by its
 * numeric map id via `--map`, and `--list-parks` discovers ids live. The map
 * ids below were verified against the live API.
 */

export interface EquipmentOption {
  id: number;
  categoryId: number;
  label: string;
}

/** Frontcountry equipment category id (the "Equipment" bucket). */
export const FRONTCOUNTRY_CATEGORY = -32768;
/** Backcountry equipment category id. */
export const BACKCOUNTRY_CATEGORY = -32767;

/** Alias -> equipment option. `subEquipmentCategoryId` is the map filter. */
export const EQUIPMENT: Record<string, EquipmentOption> = {
  "small-tent": { id: -32768, categoryId: FRONTCOUNTRY_CATEGORY, label: "Small Tent" },
  "medium-tent": { id: -32767, categoryId: FRONTCOUNTRY_CATEGORY, label: "Medium Tent" },
  "large-tent": { id: -32766, categoryId: FRONTCOUNTRY_CATEGORY, label: "Large Tent" },
  van: { id: -32765, categoryId: FRONTCOUNTRY_CATEGORY, label: "Van/Pickup" },
  "tent-trailer": { id: -32764, categoryId: FRONTCOUNTRY_CATEGORY, label: "Tent Trailer" },
  "rv-21": { id: -32763, categoryId: FRONTCOUNTRY_CATEGORY, label: "Trailer or Motorhome up to 21ft" },
  "rv-24": { id: -32762, categoryId: FRONTCOUNTRY_CATEGORY, label: "Trailer or Motorhome up to 24ft" },
  "rv-27": { id: -32761, categoryId: FRONTCOUNTRY_CATEGORY, label: "Trailer or Motorhome up to 27ft" },
  "rv-35": { id: -32760, categoryId: FRONTCOUNTRY_CATEGORY, label: "Trailer or Motorhome up to 35ft" },
  "rv-35-plus": { id: -32759, categoryId: FRONTCOUNTRY_CATEGORY, label: "Trailer or Motorhome over 35ft" },
};

/** Friendly synonyms mapped onto the canonical keys above. */
const EQUIPMENT_SYNONYMS: Record<string, string> = {
  tent: "medium-tent",
  rv: "rv-27",
  motorhome: "rv-27",
  trailer: "rv-27",
  camper: "van",
  pickup: "van",
};

export function resolveEquipment(alias: string): EquipmentOption {
  const key = alias.trim().toLowerCase();
  const canonical = EQUIPMENT_SYNONYMS[key] ?? key;
  const option = EQUIPMENT[canonical];
  if (!option) {
    throw new Error(
      `Unknown equipment "${alias}". Known: ${Object.keys(EQUIPMENT).join(", ")} (aliases: ${Object.keys(EQUIPMENT_SYNONYMS).join(", ")}).`,
    );
  }
  return option;
}

export interface ParkEntry {
  mapId: number;
  resourceLocationId: number;
  label: string;
}

/** A few known campgrounds. Use `--map <id>` / `--list-parks` for the rest. */
export const PARKS: Record<string, ParkEntry> = {
  "waterton-townsite": {
    mapId: -2147483128,
    resourceLocationId: -2147483542,
    label: "Waterton Lakes - Townsite Campground",
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
  return `https://reservation.pc.gc.ca/create-booking/results?${q.toString()}`;
}
