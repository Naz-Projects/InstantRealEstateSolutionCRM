import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Convex crons run in UTC. 11:00 UTC ≈ 7am ET. The actions are idempotent
// (skip an already-scraped month/week) so a daily check is cheap — it only
// reaches Firecrawl when the county posts a new PDF.
const crons = cronJobs();

crons.cron(
  "sheriff weekday check",
  "0 11 * * 1-5",
  internal.sheriffActions.runSheriffScrape,
  { triggeredBy: "cron", force: false },
);

crons.cron(
  "legal weekly check",
  "0 11 * * 1",
  internal.legalActions.runLegalScrape,
  { triggeredBy: "cron", force: false },
);

// Parcel spine — weekly cheap CDC key-diff (new construction in, vanished out). NOT a
// full re-pull. Sundays 09:00 UTC. Self-rescheduled + resumable; idempotent.
crons.cron(
  "parcel spine weekly sync",
  "0 9 * * 0",
  internal.parcelActions.syncSpine,
  {},
);

// Distress signals (lead engine Phase 2) — both feeds are tiny + watermarked +
// idempotent. Code cases = a few ArcGIS pages; foreclosures = ~30 polite CourtConnect
// GETs (internal use, throttled — see the Phase 2 spec ToS note).
crons.cron(
  "code violations weekly sync",
  "0 10 * * 1",
  internal.signalActions.syncCodeCases,
  {},
);

crons.cron(
  "foreclosure filings weekly sweep",
  "0 10 * * 2",
  internal.signalActions.syncForeclosures,
  {},
);

// Public market data (FRED) — refresh on the 1st of each month, 12:00 UTC (~8am ET).
// The county housing series are monthly; the action is idempotent (upsert by series).
crons.cron(
  "market data monthly",
  "0 12 1 * *",
  internal.marketActions.refreshMarketData,
  {},
);

// Monitor the Web (Zillow NCC) — daily safety net. The Firecrawl webhook is the
// primary trigger (8 PM ET); this runs the same scan if the webhook didn't fire.
// 02:00 UTC — deliberately ≥1h after 8 PM ET in BOTH offsets (EDT 8 PM = 00:00
// UTC, EST 8 PM = 01:00 UTC). 01:00 UTC would COINCIDE with the EST webhook, and
// the 20h no-op guard only counts complete runs, so they could double-scan. At
// 02:00 UTC the webhook's complete run reliably pre-empts the cron via that guard.
crons.cron(
  "monitor daily safety net",
  "0 2 * * *",
  internal.monitorActions.runMonitorScan,
  { trigger: "cron" },
);

export default crons;
