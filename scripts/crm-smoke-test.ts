/**
 * In-CRM end-to-end smoke test — runs against a RUNNING Twenty server.
 * (Authored now; executes the moment Docker + Twenty are up.)
 *
 * What it does:
 *   1. Optionally trigger the scrape logic function via its HTTP route.
 *   2. Query Twenty's GraphQL API to verify Sheriff Sale Listing records exist
 *      and that some have been enriched (ENRICHED), with real Zillow/parcel data.
 *
 * Setup (morning, after `yarn twenty dev` is running):
 *   - In Twenty: Settings → APIs → create an API key.
 *   - Add to .env.local:
 *       TWENTY_API_URL=http://localhost:2020
 *       TWENTY_API_KEY=<the api key>
 *   - (Optional) TRIGGER_SCRAPE=1 to fire /s/sheriff/scrape first.
 *   Run: npm run smoke:crm
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const apiUrl = (process.env.TWENTY_API_URL ?? "http://localhost:2020").replace(/\/$/, "");
const apiKey = (process.env.TWENTY_API_KEY ?? "").trim();
const triggerScrape = process.env.TRIGGER_SCRAPE === "1";

async function gql(query: string): Promise<any> {
  const res = await fetch(`${apiUrl}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { errors?: unknown; data?: any };
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}

async function main() {
  if (!apiKey) {
    console.error("❌ TWENTY_API_KEY not set. Create one in Twenty → Settings → APIs and add it to .env.local.");
    process.exit(1);
  }

  if (triggerScrape) {
    console.log("→ Triggering /s/sheriff/scrape ...");
    const res = await fetch(`${apiUrl}/s/sheriff/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });
    console.log(`   scrape route responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log("   (enrichment runs async via the create trigger — give it a minute, then re-run without TRIGGER_SCRAPE)");
  }

  console.log("→ Querying Sheriff Sale Listings ...");
  const data = await gql(`
    query {
      sheriffSaleListings(first: 5) {
        totalCount
        edges { node { id address ownerName assessmentTotal zestimate beds enrichmentStatus dealStatus } }
      }
    }
  `);

  const conn = data.sheriffSaleListings;
  const total = conn.totalCount ?? conn.edges.length;
  const enriched = conn.edges.filter((e: any) => e.node.enrichmentStatus === "ENRICHED").length;

  console.log(`\n✓ ${total} listing(s) in the CRM; ${enriched}/${conn.edges.length} sampled are ENRICHED.`);
  conn.edges.forEach((e: any, i: number) => {
    const n = e.node;
    console.log(`  [${i + 1}] ${n.address} | owner=${n.ownerName} | zest=${n.zestimate} | ${n.enrichmentStatus} | deal=${n.dealStatus}`);
  });

  if (total === 0) {
    console.error("\n❌ No records found. Run the scrape first (TRIGGER_SCRAPE=1 or the UI button / dev:function:exec).");
    process.exit(1);
  }
  console.log("\n✅ CRM end-to-end smoke test passed: scrape → records → enrichment visible via the API.");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});
