// NCC parcel lookup — ported from scrapers/parcel_lookup/parcel_scraper.py.
// Firecrawl browser actions drive the ASP.NET parcel search (bypassing Reblaze
// bot protection via Firecrawl's cloud browser), then we parse the detail-page
// markdown tables into structured fields.

import { firecrawlScrape, withRetry } from "./firecrawl.js";
import type { ParcelData } from "./types.js";

export const PARCEL_SEARCH_URL = "https://www3.newcastlede.gov/parcel/search/";

const INPUT_SELECTOR =
  "#ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1__TextBoxParcelNumber";
const SEARCH_BUTTON =
  "#ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1__ButtonSearch";
const DETAILS_LINK = 'a[id*="LinkButtonDetails"]';

// Markdown labels → ParcelData fields.
const FIELD_MAP: Record<string, keyof ParcelData> = {
  "Property Address:": "propertyAddress",
  "Owner:": "ownerName",
  "Owner Address:": "ownerAddress",
  "Property Class:": "propertyClass",
  "Subdivision:": "subdivision",
  "Lot Size:": "lotSize",
  "Lot Depth:": "lotDepth",
  "Lot Frontage:": "lotFrontage",
  "Land:": "assessmentLand",
  "Structure:": "assessmentStructure",
  "Total:": "assessmentTotal",
  "County Balance Due:": "countyBalanceDue",
  "School Balance Due:": "schoolBalanceDue",
  "Balance Due:": "sewerBalanceDue",
};

/** Parse parcel detail-page markdown into structured fields. Pure + testable. */
export function parseParcelMarkdown(markdown: string): Partial<ParcelData> {
  const fields: Partial<ParcelData> = {};

  for (const line of markdown.split("\n")) {
    if (!line.includes("|") || line.includes("---")) continue;

    const parts = line
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p);
    if (parts.length !== 2) continue;

    const [label, value] = parts;
    const fieldName = FIELD_MAP[label];
    if (!fieldName) continue;

    let clean = value.replace(/<br>/g, ", ").replace(/\\/g, "").trim();

    if (fieldName === "propertyAddress") {
      clean = clean.includes(", ") ? clean.split(",")[0].trim() : clean;
      const full = value.replace(/<br>/g, ", ").replace(/\\/g, "").trim();
      if (full.includes(", ")) {
        const idx = full.indexOf(", ");
        const rest = full.slice(idx + 2);
        if (rest) fields.cityStateZip = rest.trim().replace(/-+$/, "");
        clean = full.slice(0, idx).trim();
      }
    }

    if (fieldName === "ownerAddress") {
      clean = value.replace(/<br>/g, ", ").replace(/\\/g, "").trim();
    }

    fields[fieldName] = clean ? clean : undefined;
  }

  return fields;
}

/**
 * Look up a parcel via the NCC site using Firecrawl browser actions.
 *
 * NCC sits behind Reblaze bot protection, which intermittently serves a block
 * page (HTTP 200 but no parcel detail) — Firecrawl's HTTP retry can't catch that.
 * So we retry the *whole* browser-action sequence: a block on one attempt usually
 * clears on the next. Throws only if every attempt fails to reach the detail page.
 */
export async function lookupParcel(
  parcelNumber: string,
  apiKey: string,
  attempts = 3,
): Promise<ParcelData> {
  const pn = parcelNumber.trim();
  if (!pn) throw new Error("parcel_number is required");

  return withRetry(
    async () => {
      const { markdown } = await firecrawlScrape({
        url: PARCEL_SEARCH_URL,
        apiKey,
        formats: ["markdown"],
        waitFor: 3000,
        timeoutMs: 90000,
        maxRetries: 1,
        actions: [
          { type: "click", selector: INPUT_SELECTOR },
          { type: "write", text: pn },
          { type: "click", selector: SEARCH_BUTTON },
          { type: "wait", milliseconds: 5000 },
          { type: "click", selector: DETAILS_LINK },
          { type: "wait", milliseconds: 5000 },
        ],
      });

      if (markdown.length < 200) {
        throw new Error(`too little content (${markdown.length} chars) — likely bot-block`);
      }
      if (!markdown.includes("Parcel Details") && !markdown.includes("Balance Due")) {
        throw new Error("detail page not reached — likely bot-block");
      }

      return { parcelNumber: pn, ...parseParcelMarkdown(markdown) };
    },
    { attempts, baseDelayMs: 2500, label: `Parcel ${pn} lookup` },
  );
}
