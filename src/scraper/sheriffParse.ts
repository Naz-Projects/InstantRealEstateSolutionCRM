// Sheriff Sale PDF parsing — ported from the n8n "Parse Table Data" node.
// Firecrawl scrapes the NCC "Current Sheriff Sale Listing" PDF directly and
// returns clean markdown tables; we parse those into structured listings.

import { firecrawlScrape } from "./firecrawl.js";
import { cleanAddress } from "./address.js";
import type { SheriffListing } from "./types.js";

export const SHERIFF_PDF_URL =
  "https://www.newcastlede.gov/DocumentCenter/View/266/Current-Sheriff-Sale-Listing-?bidId=";

export interface ParseResult {
  listings: SheriffListing[];
  saleMonth: string;
}

function monthLabel(now: Date): string {
  return now.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/**
 * Parse Firecrawl markdown (table form) into structured sheriff-sale listings.
 * Pure + deterministic given `now`. Throws if the markdown yields no listings.
 */
export function parseSheriffMarkdown(markdown: string, now: Date = new Date()): ParseResult {
  if (!markdown || markdown.length < 100) {
    throw new Error(`Markdown empty or too short (length ${markdown?.length ?? 0})`);
  }

  const listings: SheriffListing[] = [];

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i) => i > 0);
    if (cells.length < 9) continue;
    if (cells.every((c) => !c || /^-+$/.test(c))) continue;
    const firstCell = cells[0].toUpperCase();
    if (firstCell === "TYPE" || firstCell === "" || firstCell === "TYPE ") continue;

    let type = cells[0].replace(/^TYPE/i, "").trim() || cells[0].trim();
    let attorney = cells[1].replace(/^ATTORNEY/i, "").trim();
    let plaintiff = cells[2].replace(/^PLAINTIFF/i, "").trim();
    const caseNum = cells[3].replace(/^Sheriff.*?#/i, "").trim();
    let defendant = cells[4].replace(/^DEFENDANT/i, "").trim();
    let address = cells[5].replace(/^ADDRESS/i, "").trim();
    const parcel = cells[6].replace(/^PARCEL/i, "").trim();
    const status = cells[7].replace(/^STATUS/i, "").trim();
    const principal = cells[8].replace(/^PRINCIPAL/i, "").trim();

    if (!parcel && !address && !defendant) continue;
    if (!type && !parcel) continue;

    address = cleanAddress(address);
    attorney = attorney.replace(/\s+/g, " ").trim();
    defendant = defendant.replace(/\s+/g, " ").trim();
    plaintiff = plaintiff.replace(/\s+/g, " ").trim();

    type = type.toUpperCase();
    if (type.includes("TAX")) type = "TAX";
    else if (type.includes("MTG")) type = "MTG";
    else if (type.includes("JUDG")) type = "JUDG";

    listings.push({
      type: type || "N/A",
      attorney: attorney || "N/A",
      plaintiff: plaintiff || "N/A",
      courtCaseNumber: caseNum || "N/A",
      defendant: defendant || "N/A",
      address: address || "N/A",
      parcel: parcel || "N/A",
      status: status || "N/A",
      principal: principal || "N/A",
    });
  }

  if (listings.length === 0) {
    throw new Error("No listings parsed from markdown — check Firecrawl output format.");
  }

  return { listings, saleMonth: monthLabel(now) };
}

/** Scrape the live NCC sheriff-sale PDF and return its markdown. */
export async function fetchSheriffMarkdown(apiKey: string): Promise<string> {
  const { markdown } = await firecrawlScrape({
    url: SHERIFF_PDF_URL,
    apiKey,
    formats: ["markdown"],
    timeoutMs: 60000,
  });
  return markdown;
}
