/**
 * Minimal, dependency-free client for the "GoingToCamp" reservation platform.
 * Several park systems run white-labelled instances of the same backend and
 * therefore share this exact JSON API - only the base URL, the park map ids,
 * and the equipment catalog differ. Verified instances:
 *   - Parks Canada  -> https://reservation.pc.gc.ca/api
 *   - BC Parks      -> https://camping.bcparks.ca/api
 * Pass the instance base URL via `baseUrl`. The API is unofficial and
 * undocumented, so treat the shapes below as best-effort and defensive.
 *
 * Endpoints used:
 *   GET /api/availability/map                     -> loop/site availability grid
 *   GET /api/availability/resourcedailyavailability -> per-site nightly detail
 *   GET /api/equipment                            -> equipment categories
 *   GET /api/maps/root                            -> park directory (root maps)
 *
 * Availability enum (per night, from /availability/map + resourcedailyavailability):
 *   0            -> AVAILABLE / bookable  (the only value worth alerting on)
 *   1, 5         -> reserved / unavailable
 *   3, 4         -> blocked / wrong-equipment / off-season / not reservable
 * Only `0` means "you can book this site for this night". Everything else is
 * treated as not bookable. This was verified against the live API by decoding
 * the map values against `resourcedailyavailability.processedAvailability`.
 */

/** The one availability code that means "bookable". */
export const AVAILABILITY_OPEN = 0;

/** Default base URL (Parks Canada) when a caller does not specify one. */
export const PC_API_BASE = "https://reservation.pc.gc.ca/api";

/** A recent desktop Chrome UA. The API 403s obviously-bot requests. */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface DailyAvailability {
  availability: number;
  remainingQuota: number | null;
  processedAvailability?: number;
}

export interface MapAvailabilityResponse {
  mapId: number;
  /** Aggregate availability for this map (one entry per requested night). */
  mapAvailabilities: number[];
  /** Site-level grid: resourceId -> per-night availability. Empty on parent maps. */
  resourceAvailabilities: Record<string, DailyAvailability[]>;
  /** Child maps (loops/sub-areas): childMapId -> aggregate availability. */
  mapLinkAvailabilities: Record<string, number[]>;
}

export interface LocalizedValue {
  cultureName: string;
  name?: string;
  title?: string;
}

export interface SubEquipmentCategory {
  subEquipmentCategoryId: number;
  order: number;
  localizedValues: LocalizedValue[];
}

export interface EquipmentCategory {
  equipmentCategoryId: number;
  order: number;
  localizedValues: LocalizedValue[];
  subEquipmentCategories: SubEquipmentCategory[];
}

export interface RootMapLink {
  resourceLocationId: number | null;
  childMapId: number | null;
  localizations: LocalizedValue[];
}

export interface RootMap {
  mapId: number;
  resourceLocationId: number | null;
  localizedValues: LocalizedValue[];
  mapLinks: RootMapLink[];
}

export interface MapAvailabilityQuery {
  mapId: number;
  /** Check-in date, YYYY-MM-DD. */
  startDate: string;
  /** Check-out date, YYYY-MM-DD. Must be strictly after startDate. */
  endDate: string;
  /** Frontcountry = -32768, Backcountry = -32767. */
  equipmentCategoryId: number;
  /** Specific rig/tent size (e.g. -32763 = "Trailer or Motorhome up to 21ft"). */
  subEquipmentCategoryId: number;
  partySize?: number;
  bookingCategoryId?: number;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface GoingToCampClientOptions {
  /** Injectable fetch (defaults to global fetch). Handy for tests. */
  fetchImpl?: FetchLike;
  userAgent?: string;
  baseUrl?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Retries on network error / 5xx (default 3). */
  retries?: number;
  /** Sleep function for backoff (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class GoingToCampClient {
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Number of HTTP requests this client has issued (useful for reporting). */
  public requestCount = 0;

  constructor(options: GoingToCampClientOptions = {}) {
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const resolved = options.fetchImpl ?? globalFetch;
    if (!resolved) {
      throw new Error("No fetch implementation available; pass options.fetchImpl.");
    }
    this.fetchImpl = resolved;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.baseUrl = (options.baseUrl ?? PC_API_BASE).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const query = params
      ? "?" +
        Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${this.baseUrl}/${path}${query}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms, 1s, 2s, ...
        await this.sleep(500 * 2 ** (attempt - 1));
      }
      try {
        this.requestCount++;
        const res = await this.fetchImpl(url, {
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          // 4xx (except 429) are not worth retrying - the request is wrong.
          if (res.status < 500 && res.status !== 429) {
            throw new Error(`Parks Canada API ${res.status} for ${path}`);
          }
          lastError = new Error(`Parks Canada API ${res.status} for ${path}`);
          continue;
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // A non-retryable 4xx bubbles straight up.
        if (err instanceof Error && /API 4\d\d/.test(err.message)) {
          throw err;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Parks Canada API request failed for ${path}`);
  }

  getEquipment(): Promise<EquipmentCategory[]> {
    return this.getJson<EquipmentCategory[]>("equipment");
  }

  getRootMaps(bookingCategoryId = 0): Promise<RootMap[]> {
    return this.getJson<RootMap[]>("maps/root", { bookingCategoryId });
  }

  getMapAvailability(query: MapAvailabilityQuery): Promise<MapAvailabilityResponse> {
    return this.getJson<MapAvailabilityResponse>("availability/map", {
      mapId: query.mapId,
      bookingCategoryId: query.bookingCategoryId ?? 0,
      startDate: query.startDate,
      endDate: query.endDate,
      getDailyAvailability: "true",
      isReserving: "true",
      equipmentCategoryId: query.equipmentCategoryId,
      subEquipmentCategoryId: query.subEquipmentCategoryId,
      partySize: query.partySize ?? 2,
      searchTabGroupId: 0,
      bookingCategoryTabGroupId: -1,
    });
  }

  getResourceDailyAvailability(
    resourceId: number,
    startDate: string,
    endDate: string,
  ): Promise<DailyAvailability[]> {
    return this.getJson<DailyAvailability[]>("availability/resourcedailyavailability", {
      resourceId,
      startDate,
      endDate,
    });
  }
}

/** Pull the en-CA (or first available) display string from a localized list. */
export function localizedName(values: LocalizedValue[] | undefined): string {
  if (!values || values.length === 0) return "";
  const en = values.find((v) => v.cultureName === "en-CA") ?? values[0];
  return en.name ?? en.title ?? "";
}
