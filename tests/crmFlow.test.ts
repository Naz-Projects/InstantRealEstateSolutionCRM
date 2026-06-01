// Offline integration test of the scraper -> CRM seam.
//
// Simulates exactly what the two Twenty logic functions do, against a fake
// CoreApiClient (an in-memory record store): parse the PDF markdown -> create a
// ScrapeRun -> create one Sheriff Sale Listing per row (PENDING) -> on each
// "created", enrich and update it (ENRICHED). Asserts the data written to the
// CRM is correct end-to-end. The only thing NOT exercised here is the GraphQL
// transport (Twenty's code, needs a running server).

import { describe, it, expect } from "vitest";
import { parseSheriffMarkdown } from "../src/scraper/sheriffParse.js";
import { toListingCreateData, toListingUpdateData } from "../src/scraper/crmMap.js";
import type { EnrichedListing } from "../src/scraper/enrich.js";
import type { SheriffListing } from "../src/scraper/types.js";

// --- a fake CoreApiClient that records mutations into an in-memory store ---
interface Row {
  id: string;
  [k: string]: unknown;
}
class FakeClient {
  rows = new Map<string, Row>();
  runs: Row[] = [];
  private seq = 0;
  mutation(m: Record<string, { __args: { data?: object; id?: string } }>) {
    if (m.createScrapeRun) {
      const id = `run-${++this.seq}`;
      this.runs.push({ id, ...(m.createScrapeRun.__args.data ?? {}) });
      return { createScrapeRun: { id } };
    }
    if (m.createSheriffSaleListing) {
      const id = `rec-${++this.seq}`;
      this.rows.set(id, { id, ...(m.createSheriffSaleListing.__args.data ?? {}) });
      return { createSheriffSaleListing: { id } };
    }
    if (m.updateSheriffSaleListing) {
      const { id, data } = m.updateSheriffSaleListing.__args;
      const row = this.rows.get(id!)!;
      this.rows.set(id!, { ...row, ...(data ?? {}) });
      return { updateSheriffSaleListing: { id } };
    }
    throw new Error("unexpected mutation");
  }
}

const MARKDOWN = `
nccde.org/sheriff

Gross List 06/09/2026 - 06/09/2026

| TYPE | ATTORNEY | PLAINTIFF | Sheriff's #/Courts Case # | DEFENDANT | ADDRESS | PARCEL | STATUS | PRINCIPAL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TAX | CITY OF WILMINGTON | THE CITY OF WILMINGTON | 26-01429 | GOLD PHOENIX CORP | 505 W. 5TH STREET WILMINGTON 19801 | 2603530038 | Scheduled | $11,046.98 |
| MTG | SOME FIRM | BANK NA | 26-01430 | JANE DOE | 31 PHOENIX AVENUE NEWARK 19702 | 1101430115 | Scheduled | $200,000.00 |
`;

// Stand-in for what enrichListing() returns (so this test stays offline / no Firecrawl).
function fakeEnrich(listing: SheriffListing, saleMonth: string): EnrichedListing {
  return {
    ...listing,
    saleMonth,
    ownerName: `OWNER OF ${listing.parcel}`,
    propertyAddress: listing.address,
    assessmentTotal: "100000",
    countyBalanceDue: "$1.00",
    schoolBalanceDue: "$2.00",
    sewerBalanceDue: "$3.00",
    zillowUrl: "https://www.zillow.com/homedetails/x-DE-1/1_zpid/",
    zestimate: "$250,000",
    beds: "3",
    baths: "2",
    sqft: "1,500 sqft",
  };
}

describe("scraper -> CRM flow (simulated client)", () => {
  it("parses, creates a run + PENDING listings, then enriches each to ENRICHED", () => {
    const client = new FakeClient();
    const { listings, saleMonth } = parseSheriffMarkdown(MARKDOWN);
    expect(listings).toHaveLength(2);
    expect(saleMonth).toBe("June 2026");

    // scrape-sheriff-sales: create run + listings (PENDING)
    const run = client.mutation({
      createScrapeRun: { __args: { data: { name: `Sheriff Sales — ${saleMonth}`, saleMonth } } },
    });
    const runId = (run as { createScrapeRun: { id: string } }).createScrapeRun.id;

    const createdIds: string[] = [];
    for (const l of listings) {
      const res = client.mutation({
        createSheriffSaleListing: { __args: { data: toListingCreateData(l, saleMonth, runId) } },
      });
      createdIds.push((res as { createSheriffSaleListing: { id: string } }).createSheriffSaleListing.id);
    }

    // every row starts PENDING / NEW with the scraped fields mapped correctly
    expect(client.rows.size).toBe(2);
    const first = client.rows.get(createdIds[0])!;
    expect(first.enrichmentStatus).toBe("PENDING");
    expect(first.dealStatus).toBe("NEW");
    expect(first.runId).toBe(runId);
    expect(first.saleType).toBe("TAX");
    expect(first.parcel).toBe("2603530038");
    expect(first.address).toContain("WILMINGTON");
    expect(first.principal).toBe("$11,046.98");

    // enrich-sheriff-listing: for each created row, enrich + update to ENRICHED
    for (let i = 0; i < listings.length; i++) {
      const enriched = fakeEnrich(listings[i], saleMonth);
      client.mutation({
        updateSheriffSaleListing: { __args: { id: createdIds[i], data: toListingUpdateData(enriched) } },
      });
    }

    const enrichedRow = client.rows.get(createdIds[0])!;
    expect(enrichedRow.enrichmentStatus).toBe("ENRICHED");
    expect(enrichedRow.ownerName).toBe("OWNER OF 2603530038");
    expect(enrichedRow.zestimate).toBe("$250,000");
    expect(enrichedRow.beds).toBe("3");
    // pipeline status is preserved through enrichment (not overwritten)
    expect(enrichedRow.dealStatus).toBe("NEW");
  });
});
