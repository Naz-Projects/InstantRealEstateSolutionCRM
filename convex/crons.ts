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

// Public market data (FRED) — refresh on the 1st of each month, 12:00 UTC (~8am ET).
// The county housing series are monthly; the action is idempotent (upsert by series).
crons.cron(
  "market data monthly",
  "0 12 1 * *",
  internal.marketActions.refreshMarketData,
  {},
);

export default crons;
