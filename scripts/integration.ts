/**
 * Live end-to-end integration test against the REAL Firecrawl API.
 * Proves the automation works locally, independent of any CRM/host.
 *
 * Run: npm run integration   (reads FIRECRAWL_API_KEY from .env.local)
 *
 * Cost: ~1 Firecrawl call for the PDF + 2 per enriched listing (parcel + Zillow).
 */
import { config } from "dotenv";
import { fetchSheriffMarkdown, parseSheriffMarkdown } from "../src/scraper/sheriffParse.js";
import { enrichListing } from "../src/scraper/enrich.js";

config({ path: ".env.local" });

const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE ?? 3);

function line() {
  console.log("─".repeat(72));
}

async function main() {
  if (!apiKey) {
    console.error("❌ FIRECRAWL_API_KEY not set in .env.local");
    process.exit(1);
  }

  line();
  console.log("STEP 1 — Scrape the NCC Sheriff Sale PDF via Firecrawl");
  line();
  const t0 = Date.now();
  const markdown = await fetchSheriffMarkdown(apiKey);
  console.log(`✓ Firecrawl returned ${markdown.length} chars of markdown in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const { listings, saleMonth } = parseSheriffMarkdown(markdown);
  console.log(`✓ Parsed ${listings.length} listings (sale month label: ${saleMonth})`);
  console.log("\nFirst few parsed listings:");
  listings.slice(0, 5).forEach((l, i) => {
    console.log(`  [${i + 1}] ${l.type.padEnd(5)} | ${l.address}  | parcel=${l.parcel}`);
  });

  line();
  console.log(`STEP 2 — Enrich first ${SAMPLE_SIZE} listings (parcel + Zillow), like the fan-out`);
  line();

  const sample = listings.slice(0, SAMPLE_SIZE);
  let ok = 0;
  const errorCounts: Record<string, number> = {};

  for (let i = 0; i < sample.length; i++) {
    const t = Date.now();
    const e = await enrichListing(sample[i], saleMonth, apiKey);
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    console.log(`\n[${i + 1}/${sample.length}] ${e.defendant}  (${secs}s)`);
    console.log(`   address:     ${e.address}`);
    console.log(`   parcel:      ${e.parcel}`);
    console.log(`   owner:       ${e.ownerName}`);
    console.log(`   assessment:  ${e.assessmentTotal}`);
    console.log(`   county/school/sewer: ${e.countyBalanceDue} / ${e.schoolBalanceDue} / ${e.sewerBalanceDue}`);
    console.log(`   zillow:      ${e.zillowUrl}`);
    console.log(`   zestimate:   ${e.zestimate}   beds=${e.beds} baths=${e.baths} sqft=${e.sqft}`);

    const ERRORS = ["SCRAPE FAILED", "NOT FOUND", "NO ADDRESS", "WRONG STATE", "NO PARCEL", "NO STATE", "BAD ADDRESS"];
    const hadParcel = !ERRORS.includes(e.ownerName);
    const hadZillow = !ERRORS.includes(e.zillowUrl);
    if (hadParcel || hadZillow) ok++;
    for (const f of [e.ownerName, e.zillowUrl]) {
      if (ERRORS.includes(f)) errorCounts[f] = (errorCounts[f] ?? 0) + 1;
    }
  }

  line();
  console.log("SUMMARY");
  line();
  console.log(`Listings parsed:        ${listings.length}`);
  console.log(`Sample enriched:        ${sample.length}`);
  console.log(`Had parcel or Zillow:   ${ok}/${sample.length}`);
  console.log(`Error-code tallies:     ${JSON.stringify(errorCounts)}`);
  console.log("\n✅ Pipeline ran end-to-end against live Firecrawl.");
}

main().catch((err) => {
  console.error("\n❌ Integration run failed:", err);
  process.exit(1);
});
