/**
 * Recursively walks a Parks Canada campground map, drilling from parent maps
 * into their child loops until it reaches leaf maps that expose site-level
 * availability, then reports which individual sites are bookable for the stay.
 */

import {
  AVAILABILITY_OPEN,
  type MapAvailabilityQuery,
  ParksCanadaClient,
} from "./parks-canada.ts";
import { addDays, assertIsoDate, daysBetween } from "./dates.ts";

export interface ScanQuery {
  /** Campground/loop map to scan (parent maps are expanded automatically). */
  mapId: number;
  /** Check-in date, YYYY-MM-DD. */
  start: string;
  /** Number of nights to stay (>= 1). */
  nights: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId: number;
  partySize?: number;
  bookingCategoryId?: number;
  /** Safety bound on recursion depth (default 8). */
  maxDepth?: number;
}

export interface SiteAvailability {
  resourceId: number;
  /** Per-night availability codes for the requested stay. */
  nightly: number[];
  /** How many of the requested nights are individually bookable. */
  openNights: number;
  /** True when every requested night is bookable (a whole-stay opening). */
  openWholeStay: boolean;
}

export interface ScanResult {
  query: ScanQuery;
  /** Total individual sites seen across all leaf loops. */
  totalSites: number;
  /** Every site with at least one bookable night. */
  sitesWithOpenings: SiteAvailability[];
  /** Sites bookable for the full requested stay. */
  wholeStaySites: SiteAvailability[];
  /** HTTP requests issued for this scan. */
  apiCalls: number;
}

function isBookable(code: number): boolean {
  return code === AVAILABILITY_OPEN;
}

/**
 * Scan a campground for openings. Walks the map tree breadth-first-ish via
 * recursion, guarding against cycles and runaway depth.
 */
export async function scanCampground(
  client: ParksCanadaClient,
  query: ScanQuery,
): Promise<ScanResult> {
  assertIsoDate(query.start, "start date");
  if (!Number.isInteger(query.nights) || query.nights < 1) {
    throw new Error(`nights must be a positive integer, got ${query.nights}`);
  }
  const endDate = addDays(query.start, query.nights);
  const maxDepth = query.maxDepth ?? 8;
  const startCalls = client.requestCount;

  const baseParams: Omit<MapAvailabilityQuery, "mapId"> = {
    startDate: query.start,
    endDate,
    equipmentCategoryId: query.equipmentCategoryId,
    subEquipmentCategoryId: query.subEquipmentCategoryId,
    partySize: query.partySize,
    bookingCategoryId: query.bookingCategoryId,
  };

  const visited = new Set<number>();
  const sites: SiteAvailability[] = [];

  const walk = async (mapId: number, depth: number): Promise<void> => {
    if (visited.has(mapId) || depth > maxDepth) return;
    visited.add(mapId);

    const res = await client.getMapAvailability({ ...baseParams, mapId });

    for (const [resourceId, nights] of Object.entries(res.resourceAvailabilities ?? {})) {
      const nightly = nights.map((n) => n.availability);
      const openNights = nightly.filter(isBookable).length;
      sites.push({
        resourceId: Number(resourceId),
        nightly,
        openNights,
        // Require a value for every requested night before calling it whole-stay.
        openWholeStay: nightly.length === query.nights && nightly.every(isBookable),
      });
    }

    const childIds = Object.keys(res.mapLinkAvailabilities ?? {}).map(Number);
    for (const childId of childIds) {
      await walk(childId, depth + 1);
    }
  };

  await walk(query.mapId, 0);

  const sitesWithOpenings = sites.filter((s) => s.openNights > 0);
  const wholeStaySites = sites.filter((s) => s.openWholeStay);

  return {
    query,
    totalSites: sites.length,
    sitesWithOpenings,
    wholeStaySites,
    apiCalls: client.requestCount - startCalls,
  };
}

/**
 * Given a previous and current scan, return the resource IDs that newly became
 * bookable for the whole stay. Used by the watch loop to alert only on fresh
 * openings rather than re-alerting on the same site every poll.
 */
export function newlyOpenedSites(previous: ScanResult | null, current: ScanResult): number[] {
  const before = new Set((previous?.wholeStaySites ?? []).map((s) => s.resourceId));
  return current.wholeStaySites.map((s) => s.resourceId).filter((id) => !before.has(id));
}

/** Convenience: iterate candidate check-in dates across a flexible range. */
export function* checkInDates(rangeStart: string, rangeEnd: string, nights: number): Generator<string> {
  // Last valid check-in leaves room for the whole stay before rangeEnd.
  const lastCheckIn = daysBetween(rangeStart, rangeEnd) - nights;
  for (let offset = 0; offset <= lastCheckIn; offset++) {
    yield addDays(rangeStart, offset);
  }
}
