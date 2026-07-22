#!/usr/bin/env node
/**
 * campnab - a Parks Canada campsite cancellation scanner.
 *
 * Watches reservation.pc.gc.ca for openings at a campground (including sold-out
 * dates) and alerts you when a site matching your criteria frees up. Run a
 * one-shot scan, a flexible-date sweep, or a --watch loop with notifications.
 *
 * Run:  node --import tsx campnab/cli.ts --help   (or: bun campnab/cli.ts --help)
 */

import { localizedName, ParksCanadaClient, type RootMap } from "./parks-canada.ts";
import { addDays, assertIsoDate, daysBetween, todayIso } from "./dates.ts";
import { newlyOpenedSites, scanCampground, type ScanResult } from "./scanner.ts";
import {
  buildBookingUrl,
  EQUIPMENT,
  type EquipmentOption,
  PARKS,
  resolveEquipment,
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

const HELP = `campnab - Parks Canada campsite cancellation scanner

Usage:
  campnab --park <alias> --start <YYYY-MM-DD> [options]
  campnab --map <id> --start <YYYY-MM-DD> [options]

Target (one required):
  --park <alias>          Known park (e.g. waterton-townsite). See --list-parks.
  --map <id>              Any campground/loop map id (negative number).
  --resource-location <id>  Resource-location id for the booking link (with --map).

Search:
  --start <YYYY-MM-DD>    Check-in date (default: tomorrow).
  --nights <n>            Nights to stay (default: 2).
  --flex-end <YYYY-MM-DD> Sweep every check-in from --start up to this date.
  --equipment <alias>     Rig/tent type (default: small-tent). See --list-equipment.
  --party <n>             Party size (default: 2).

Watch mode:
  --watch                 Poll on an interval and alert on new openings.
  --interval <seconds>    Poll interval (default: 300, min: 60).
  --webhook <url>         POST openings to a Discord/Slack-compatible webhook.
  --exec <cmd>            Run a shell command on an opening (CAMPNAB_* env vars).

Info:
  --list-parks            List reservable parks/campgrounds from the live API.
  --list-equipment        List equipment aliases.
  --help                  Show this help.

Availability is read from the same API the booking site uses. Only sites that
are actually bookable (availability code 0) are reported. Be a good citizen:
keep --interval reasonable.`;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    start: addDays(todayIso(), 1),
    nights: 2,
    equipment: "small-tent",
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

function listEquipment(): void {
  process.stdout.write("Equipment aliases:\n");
  for (const [alias, opt] of Object.entries(EQUIPMENT)) {
    process.stdout.write(`  ${alias.padEnd(12)} ${opt.label}\n`);
  }
  process.stdout.write("  aliases: tent, rv, motorhome, trailer, camper, pickup\n");
}

async function listParks(client: ParksCanadaClient): Promise<void> {
  const roots = await client.getRootMaps();
  process.stdout.write("Reservable locations (park -> campgrounds):\n");
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
  mapId: number;
  resourceLocationId: number;
  label: string;
}

function resolveTarget(opts: CliOptions): Target {
  if (opts.park) {
    const p = resolvePark(opts.park);
    return { mapId: p.mapId, resourceLocationId: p.resourceLocationId, label: p.label };
  }
  if (opts.mapId != null && Number.isFinite(opts.mapId)) {
    return {
      mapId: opts.mapId,
      // Fall back to the map id; the booking link still opens the right area.
      resourceLocationId: opts.resourceLocationId ?? opts.mapId,
      label: `map ${opts.mapId}`,
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
  client: ParksCanadaClient,
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
  client: ParksCanadaClient,
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
  if (opts.listEquipment) {
    listEquipment();
    return 0;
  }

  const client = new ParksCanadaClient();

  if (opts.listParks) {
    await listParks(client);
    return 0;
  }

  let target: Target;
  let equip: EquipmentOption;
  try {
    target = resolveTarget(opts);
    equip = resolveEquipment(opts.equipment);
    if (!Number.isInteger(opts.nights) || opts.nights < 1) {
      throw new Error(`--nights must be a positive integer, got ${opts.nights}`);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

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
