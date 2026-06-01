/**
 * Live end-to-end test of the Legal Notices pipeline:
 * Firecrawl the NCC Legal Notices page -> latest weekly PDF -> LLM extraction
 * via OpenRouter. Run: npm run integration:legal
 *
 * Reads FIRECRAWL_API_KEY and OPENROUTER_API_KEY from .env.local.
 */
import { config } from "dotenv";
import { fetchLatestLegalNoticesPdf, extractLegalListings } from "../src/scraper/legalNotices.js";

config({ path: ".env.local" });

const firecrawlKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
const openrouterKey = (process.env.OPENROUTER_API_KEY ?? "").trim();

async function main() {
  if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY not set");
  if (!openrouterKey) throw new Error("OPENROUTER_API_KEY not set");

  console.log("─".repeat(72));
  console.log("STEP 1 — Find + scrape the latest NCC Legal Notices PDF (Firecrawl)");
  console.log("─".repeat(72));
  const { pdfText, pdfUrl, dateFound } = await fetchLatestLegalNoticesPdf(firecrawlKey);
  console.log(`✓ PDF: ${pdfUrl}`);
  console.log(`✓ date: ${dateFound} | ${pdfText.length} chars of text`);

  console.log("─".repeat(72));
  console.log(`STEP 2 — LLM-extract estate listings via OpenRouter (${process.env.LEGAL_LLM_MODEL || "anthropic/claude-3.5-haiku"})`);
  console.log("─".repeat(72));
  const listings = await extractLegalListings(pdfText, openrouterKey, dateFound);
  console.log(`✓ Extracted ${listings.length} estate listings\n`);
  listings.slice(0, 8).forEach((l, i) => {
    console.log(`  [${i + 1}] ${l.ownerName}`);
    console.log(`      address: ${l.address}`);
    console.log(`      rep:     ${l.personalRepresentative}`);
  });

  console.log("\n✅ Legal Notices pipeline ran end-to-end (Firecrawl + OpenRouter).");
}

main().catch((err) => {
  console.error("\n❌ Legal integration failed:", err);
  process.exit(1);
});
