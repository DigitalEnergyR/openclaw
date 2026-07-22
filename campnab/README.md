# campnab

A **campsite cancellation scanner** for the "GoingToCamp" reservation platform.
Multiple park systems run the same white-labelled backend, so one tool watches
all of them. Verified instances:

- **Parks Canada** — [reservation.pc.gc.ca](https://reservation.pc.gc.ca)
- **BC Parks** — [camping.bcparks.ca](https://camping.bcparks.ca)

It watches a campground for openings — including sold-out dates — and alerts you
the moment a site matching your criteria (dates, nights, rig/tent size, party
size) frees up because someone cancelled.

Peak-summer sites at popular parks (Waterton, Banff, Moyie Lake, Mabel Lake)
sell out within minutes of the booking window opening. The realistic way to
land one is to pounce on cancellations, and cancellations happen constantly.
campnab does the watching for you.

## How it works

It calls the same JSON API the official booking sites use. Instances share the
API shape but each has its own base URL, park map ids, and **equipment catalog**
(the same numeric equipment id means different rig sizes on different systems),
so equipment is always resolved against the park's instance.

| Endpoint                                    | Purpose                              |
| ------------------------------------------- | ------------------------------------ |
| `GET /api/maps/root`                        | Park / campground directory          |
| `GET /api/equipment`                        | Equipment (rig/tent) categories      |
| `GET /api/availability/map`                 | Loop + site availability grid        |
| `GET /api/availability/resourcedailyavailability` | Per-site nightly detail        |

A campground map is a tree: a parent map links to loops, and leaf loops expose
per-site, per-night availability codes. The scanner walks that tree and treats
a night as bookable **only** when its availability code is `0` (verified
against the API's normalized `processedAvailability`). Codes `1`/`5` mean
reserved, `3`/`4` mean blocked / wrong-equipment / off-season.

For an `N`-night stay the API returns `N + 1` daily entries — the nights you
occupy plus the checkout day. campnab requires the first `N` (the occupied
nights) to be open and ignores the trailing checkout-day entry.

> The API is unofficial and undocumented. Shapes may change. Keep `--interval`
> reasonable and don't hammer it.

## Requirements

- Node 22+ (uses global `fetch` and `AbortSignal.timeout`). The tool has **zero
  runtime dependencies**; `tsx` and `vitest` are dev-only.
- Run with `node --import tsx` (Node's `fetch` honours the standard
  `HTTPS_PROXY`/CA environment; `bun`'s does not in some sandboxes).

```bash
cd campnab
bun install        # or: npm install / pnpm install  (dev deps only)
```

## Usage

```bash
node --import tsx cli.ts --help
```

### One-shot scan

```bash
# Waterton Townsite (Parks Canada), RV up to 27ft, check-in Sep 5 for 2 nights
node --import tsx cli.ts --park waterton-townsite --equipment rv-27 \
  --start 2026-09-05 --nights 2

# Moyie Lake (BC Parks), RV up to 32ft, check-in Sep 15 for 1 night
node --import tsx cli.ts --park moyie-lake --equipment rv-32 \
  --start 2026-09-15 --nights 1

# Mabel Lake (BC Parks), tent, check-in Sep 15 for 2 nights
node --import tsx cli.ts --park mabel-lake --equipment tent \
  --start 2026-09-15 --nights 2
```

Built-in `--park` aliases: `waterton-townsite`, `moyie-lake`, `mabel-lake`.
Exit code is `0` if anything is open, `1` if not — handy for scripting.

### Flexible dates

Sweep every check-in date in a range (great when you're date-flexible):

```bash
node --import tsx cli.ts --park waterton-townsite --equipment rv-27 \
  --start 2026-08-01 --flex-end 2026-09-01 --nights 2
```

### Watch mode (the point of the tool)

Poll on an interval and alert on **newly** opened sites:

```bash
# Console bell + a Discord/Slack-compatible webhook
node --import tsx cli.ts --park waterton-townsite --equipment rv-27 \
  --start 2026-08-01 --flex-end 2026-09-01 --nights 2 \
  --watch --interval 300 \
  --webhook "https://discord.com/api/webhooks/XXX/YYY"
```

Notification sinks:

- **console** (always on): prints the opening and rings the terminal bell.
- `--webhook <url>`: POSTs JSON with both `content` (Discord) and `text`
  (Slack) keys, so a raw incoming-webhook URL from either works.
- `--exec <cmd>`: runs a shell command with `CAMPNAB_TITLE`, `CAMPNAB_TEXT`,
  `CAMPNAB_URL`, `CAMPNAB_SITES` in the environment — wire it to `ntfy`,
  `osascript`, Twilio SMS, etc.

```bash
--exec 'curl -d "$CAMPNAB_TEXT $CAMPNAB_URL" ntfy.sh/my-camping-topic'
```

### Discovering parks and equipment

`--list-parks` and `--list-equipment` operate on one instance at a time
(default `parks-canada`; pass `--instance bc-parks` for BC):

```bash
node --import tsx cli.ts --list-parks                      # Parks Canada campgrounds + map ids
node --import tsx cli.ts --list-parks --instance bc-parks  # BC Parks campgrounds + map ids
node --import tsx cli.ts --list-equipment --instance bc-parks
```

Any campground works via its numeric map id, even if it's not in the built-in
registry. Pass `--instance` so the right base URL and equipment catalog are
used:

```bash
node --import tsx cli.ts --map -2147483140 --resource-location -2147483558 \
  --instance parks-canada --equipment small-tent --start 2026-08-11 --nights 2
```

## Equipment aliases

Equipment differs per instance — run `--list-equipment --instance <id>` for the
authoritative list.

- **Parks Canada:** `small-tent`, `medium-tent`, `large-tent`, `van`,
  `tent-trailer`, `rv-21`, `rv-24`, `rv-27`, `rv-35`, `rv-35-plus`.
- **BC Parks:** `tent-1`, `tent-2`, `tent-3`, `van`, `trailer-18`, `rv-32`,
  `rv-32-plus`.

Both instances accept the synonyms `tent`, `rv`, `motorhome`, `trailer`,
`camper`, `pickup` (each maps to a sensible option for that system), so
`--equipment tent` and `--equipment rv` work everywhere. Bigger rigs match fewer
sites, so pick the size closest to your actual rig for accurate results.

## Development

```bash
npm test            # vitest, all mocked — no network
```

## Files

| File              | Responsibility                                             |
| ----------------- | ---------------------------------------------------------- |
| `goingtocamp.ts`  | Typed API client (UA header, timeout, retry/backoff).      |
| `scanner.ts`      | Recursive map walk, opening detection, poll diffing.       |
| `registry.ts`     | Instances, park + equipment tables, booking-link builder.  |
| `notify.ts`       | console / webhook / exec notification sinks.               |
| `dates.ts`        | UTC calendar-date helpers.                                 |
| `cli.ts`          | Argument parsing, one-shot / flex / watch.                 |
