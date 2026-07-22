#!/usr/bin/env node
/**
 * campnab - a campsite cancellation scanner for GoingToCamp reservation systems
 * (Parks Canada, BC Parks).
 *
 * Watches for openings at a campground (including sold-out dates) and alerts you
 * when a site matching your criteria frees up. Run a one-shot scan, a
 * flexible-date sweep, or a --watch loop with notifications.
 *
 * Run:  node --import tsx campnab/cli.ts --help
 */

import { localizedName, GoingToCampClient, type RootMap } from "./goingtocamp.ts";
import { addDays, assertIsoDate, daysBetween, todayIso } from "./dates.ts";
import { newlyOpenedSites, scanCampground, type ScanResult } from "./scanner.ts";
import {
  buildBookingUrl,
  DEFAULT_INSTANCE,
  type EquipmentOption,
  type GoingToCampInstance,
  PARKS,
  resolveEquipment,
  resolveInstance,
  resolvePark,
} from "./registry.ts";
import {
  consoleNotifier,
  execNotifier,
  type Notifier,
  notifyAll,
  webhookNotifier,
} from "./notify.ts";

interface CliOptions {
  park?: string;
  mapId?: number;
  instance?: string;
  resourceLocationId?: number;
  start: string;
  flexEnd?: string;
  nights: number;
  equipment: string;
  party: number;
  watch: boolean;
  intervalSec: number;
  webhook?: string;
  exec?: string;
  listParks: boolean;
  listEquipment: boolean;
  help: boolean;
}

const HELP = `campnab - campsite cancellation scanner for GoingToCamp reservation
systems (Parks Canada + BC Parks)

Usage:
  campnab --park <alias> --start <YYYY-MM-DD> [options]
  campnab --map <id> [--instance <id>] --start <YYYY-MM-DD> [options]

Target (one required):
  --park <alias>          Known park (e.g. waterton-townsite, moyie-lake,
                          mabel-lake). See --list-parks.
  --map <id>              Any campground/loop map id (negative number).
  --instance <id>         Reservation system for --map: parks-canada (default)
                          or bc-parks.
  --resource-location <id>  Resource-location id for the booking link (with --map).

Search:
  --start <YYYY-MM-DD>    Check-in date (default: tomorrow).
  --nights <n>            Nights to stay (default: 2).
  --flex-end <YYYY-MM-DD> Sweep every check-in from --start up to this date.
  --equipment <alias>     Rig/tent type (default: tent). See --list-equipment.
  --party <n>             Party size (default: 2).

Watch mode:
  --watch                 Poll on an interval and alert on new openings.
  --interval <seconds>    Poll interval (default: 300, min: 60).
  --webhook <url>         POST openings to a Discord/Slack-compatible webhook.
  --exec <cmd>            Run a shell command on an opening (CAMPNAB_* env vars).

Info:
  --list-parks [--instance <id>]     List reservable campgrounds from the live API.
  --list-equipment [--instance <id>] List equipment aliases for an instance.
  --help                  Show this help.

Availability is read from the same API the booking site uses. Only sites that
are actually bookable (availability code 0) are reported. Be a good citizen:
keep --interval reasonable.`;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    start: addDays(todayIso(), 1),
    nights: 2,
    equipment: "tent",
    party: 2,
    watch: false,
    intervalSec: 300,
    listParks: false,
    listEquipment: false,
    help: false,
  };
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${flag} requires a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--park": opts.park = need(i, arg); i++; break;
      case "--map": opts.mapId = Number(need(i, arg)); i++; break;
      case "--instance": opts.instance = need(i, arg); i++; break;
      case "--resource-location": opts.resourceLocationId = Number(need(i, arg)); i++; break;
      case "--start": opts.start = need(i, arg); i++; break;
      case "--nights": opts.nights = Number(need(i, arg)); i++; break;
      case "--flex-end": opts.flexEnd = need(i, arg); i++; break;
      case "--equipment": opts.equipment = need(i, arg); i++; break;
      case "--party": opts.party = Number(need(i, arg)); i++; break;
      case "--watch": opts.watch = true; break;
      case "--interval": opts.intervalSec = Number(need(i, arg)); i++; break;
      case "--webhook": opts.webhook = need(i, arg); i++; break;
      case "--exec": opts.exec = need(i, arg); i++; break;
      case "--list-parks": opts.listParks = true; break;
      case "--list-equipment": opts.listEquipment = true; break;
      case "-h":
      case "--help": opts.help = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function listEquipment(instance: GoingToCampInstance): void {
  process.stdout.write(`Equipment aliases for ${instance.label}:\n`);
  for (const [alias, opt] of Object.entries(instance.equipment)) {
    process.stdout.write(`  ${alias.padEnd(12)} ${opt.label}\n`);
  }
  process.stdout.write(`  synonyms: ${Object.keys(instance.equipmentSynonyms).join(", ")}\n`);
}

async function listParks(client: GoingToCampClient, instance: GoingToCampInstance): Promise<void> {
  const builtIn = Object.entries(PARKS).filter(([, p]) => p.instance === instance.id);
  if (builtIn.length > 0) {
    process.stdout.write(`Built-in --park aliases for ${instance.label}:\n`);
    for (const [alias, p] of builtIn) {
      process.stdout.write(`  --park ${alias.padEnd(18)} ${p.label}\n`);
    }
    process.stdout.write("\n");
  }
  const roots = await client.getRootMaps();
  process.stdout.write(`Reservable locations on ${instance.label} (area -> campgrounds):\n`);
  for (const root of roots as RootMap[]) {
    const parkName = localizedName(root.localizedValues);
    if (!parkName) continue;
    process.stdout.write(`\n${parkName}  [root map ${root.mapId}]\n`);
    for (const link of root.mapLinks ?? []) {
      const name = localizedName(link.localizations);
      if (name && link.childMapId != null) {
        process.stdout.write(
          `  --map ${String(link.childMapId).padEnd(12)} ${name}` +
            (link.resourceLocationId != null
              ? `  (--resource-location ${link.resourceLocationId})`
              : "") +
            "\n",
        );
      }
    }
  }
}

interface Target {
  instance: GoingToCampInstance;
  mapId: number;
  resourceLocationId: number;
  label: string;
}

function resolveTarget(opts: CliOptions): Target {
  if (opts.park) {
    const p = resolvePark(opts.park);
    const instance = resolveInstance(p.instance);
    return {
      instance,
      mapId: p.mapId,
      resourceLocationId: p.resourceLocationId,
      label: `${p.label} [${instance.label}]`,
    };
  }
  if (opts.mapId != null && Number.isFinite(opts.mapId)) {
    const instance = resolveInstance(opts.instance ?? DEFAULT_INSTANCE);
    return {
      instance,
      mapId: opts.mapId,
      // Fall back to the map id; the booking link still opens the right area.
      resourceLocationId: opts.resourceLocationId ?? opts.mapId,
      label: `map ${opts.mapId} [${instance.label}]`,
    };
  }
  throw new Error("Specify a target with --park <alias> or --map <id>. See --help.");
}

/** Candidate check-in dates: just --start, or a flexible sweep to --flex-end. */
function checkInsFor(opts: CliOptions): string[] {
  assertIsoDate(opts.start, "start date");
  if (!opts.flexEnd) return [opts.start];
  assertIsoDate(opts.flexEnd, "flex-end date");
  const lastCheckIn = daysBetween(opts.start, opts.flexEnd) - opts.nights;
  if (lastCheckIn < 0) return [opts.start];
  const out: string[] = [];
  for (let o = 0; o <= lastCheckIn; o++) out.push(addDays(opts.start, o));
  return out;
}

interface DatedScan {
  date: string;
  result: ScanResult;
}

async function scanAllDates(
  client: GoingToCampClient,
  target: Target,
  opts: CliOptions,
  equip: EquipmentOption,
): Promise<DatedScan[]> {
  const out: DatedScan[] = [];
  for (const date of checkInsFor(opts)) {
    const result = await scanCampground(client, {
      mapId: target.mapId,
      start: date,
      nights: opts.nights,
      equipmentCategoryId: equip.categoryId,
      subEquipmentCategoryId: equip.id,
      partySize: opts.party,
    });
    out.push({ date, result });
  }
  return out;
}

function bookingLinkFor(target: Target, date: string, opts: CliOptions, equip: EquipmentOption): string {
  return buildBookingUrl({
    bookingHost: target.instance.bookingHost,
    resourceLocationId: target.resourceLocationId,
    mapId: target.mapId,
    startDate: date,
    endDate: addDays(date, opts.nights),
    nights: opts.nights,
    equipmentCategoryId: equip.categoryId,
    subEquipmentCategoryId: equip.id,
    partySize: opts.party,
  });
}

function reportOnce(scans: DatedScan[], target: Target, opts: CliOptions, equip: EquipmentOption): number {
  let openCount = 0;
  process.stdout.write(
    `\n${target.label} - ${equip.label}, ${opts.nights} night(s), party ${opts.party}\n`,
  );
  for (const { date, result } of scans) {
    const open = result.wholeStaySites.length;
    openCount += open;
    const checkout = addDays(date, opts.nights);
    if (open > 0) {
      const ids = result.wholeStaySites.map((s) => s.resourceId).slice(0, 10).join(", ");
      const more = result.wholeStaySites.length > 10 ? ", ..." : "";
      process.stdout.write(
        `  ${date} -> ${checkout}: ${open} site(s) OPEN of ${result.totalSites}  [${ids}${more}]\n` +
          `    book: ${bookingLinkFor(target, date, opts, equip)}\n`,
      );
    } else {
      process.stdout.write(
        `  ${date} -> ${checkout}: none of ${result.totalSites} sites open\n`,
      );
    }
  }
  return openCount;
}

async function runWatch(
  client: GoingToCampClient,
  target: Target,
  opts: CliOptions,
  equip: EquipmentOption,
  notifiers: Notifier[],
): Promise<void> {
  const intervalMs = Math.max(60, opts.intervalSec) * 1000;
  const previous = new Map<string, ScanResult>();
  process.stderr.write(
    `Watching ${target.label} (${equip.label}) every ${intervalMs / 1000}s. Ctrl-C to stop.\n`,
  );
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      const scans = await scanAllDates(client, target, opts, equip);
      for (const { date, result } of scans) {
        const fresh = newlyOpenedSites(previous.get(date) ?? null, result);
        previous.set(date, result);
        if (fresh.length > 0) {
          const checkout = addDays(date, opts.nights);
          const payload = {
            title: `Campsite opening: ${target.label}`,
            text: `${fresh.length} site(s) opened for ${date} -> ${checkout} (${equip.label}, party ${opts.party}): ${fresh.join(", ")}`,
            url: bookingLinkFor(target, date, opts, equip),
            resourceIds: fresh,
          };
          await notifyAll(notifiers, payload);
        }
      }
      const totalOpen = scans.reduce((a, s) => a + s.result.wholeStaySites.length, 0);
      process.stderr.write(`[${new Date().toISOString()}] scanned; ${totalOpen} open now.\n`);
    } catch (err) {
      process.stderr.write(`scan error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function main(argv: string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}\n`);
    return 2;
  }

  if (opts.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  try {
    if (opts.listEquipment) {
      listEquipment(resolveInstance(opts.instance ?? DEFAULT_INSTANCE));
      return 0;
    }
    if (opts.listParks) {
      const instance = resolveInstance(opts.instance ?? DEFAULT_INSTANCE);
      await listParks(new GoingToCampClient({ baseUrl: instance.apiBaseUrl }), instance);
      return 0;
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let target: Target;
  let equip: EquipmentOption;
  try {
    target = resolveTarget(opts);
    equip = resolveEquipment(target.instance, opts.equipment);
    if (!Number.isInteger(opts.nights) || opts.nights < 1) {
      throw new Error(`--nights must be a positive integer, got ${opts.nights}`);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const client = new GoingToCampClient({ baseUrl: target.instance.apiBaseUrl });

  if (opts.watch) {
    const notifiers: Notifier[] = [consoleNotifier()];
    if (opts.webhook) notifiers.push(webhookNotifier(opts.webhook));
    if (opts.exec) notifiers.push(execNotifier(opts.exec));
    await runWatch(client, target, opts, equip, notifiers);
    return 0; // watch runs until interrupted
  }

  const scans = await scanAllDates(client, target, opts, equip);
  const openCount = reportOnce(scans, target, opts, equip);
  process.stderr.write(`\n(${client.requestCount} API calls)\n`);
  return openCount > 0 ? 0 : 1;
}

// Only run when invoked directly, not when imported by tests.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /cli\.[cm]?ts$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`fatal: ${detail}\n`);
      process.exit(1);
    });
}
