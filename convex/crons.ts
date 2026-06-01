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

export default crons;
