# Property Zillow facts — auto-fill beds/baths/sqft/Zestimate on add

**Date:** 2026-06-04
**Status:** Design (approved verbally; pending written review)

## Problem

On the Properties page, adding a property already triggers a Zillow scrape — but it
only extracts the **photo**. The bed / bath / sqft / Zestimate boxes on the property
detail page stay empty (unless the property was seeded from a Sheriff/Legal listing
that already carried those). The user wants those facts pulled from Zillow and dropped
into the detail boxes automatically as soon as a property is added.

## Key insight (why this is small)

`convex/propertyActions.ts → scrapePropertyImage` **already downloads the Zillow
search-page markdown** (it calls `firecrawlScrape({ formats: ["markdown","rawHtml"] })`
and uses only `extractImageUrl`). The pure, already-unit-tested
`src/scraper/zillow.ts → extractFields(markdown)` parses **beds, baths, zestimate, sqft**
from that exact markdown. So this is "use data we already fetch" — **no extra Firecrawl
call, no extra cost.**

## Design

### 1. New pure helper — `pickZillowFacts(markdown, rawHtml)` in `src/scraper/zillow.ts`

Encapsulates the trust gate + extraction + sqft parse so it can be unit-tested:

- Resolve the canonical homedetails URL via the existing
  `extractHomedetailsUrl(markdown) ?? extractHomedetailsUrl(rawHtml)`.
- **Trust gate:** if there's no URL or it is **not** a Delaware match
  (`isDelawareUrl(url)` — the `-DE-` guard the rest of the app already uses), return
  `null`. We will **not** write facts we can't trust; the detail form stays blank for
  manual entry. (Photo logic is unchanged — a wrong photo is low-harm; wrong *facts*
  are not.)
- On a confident DE match, run `extractFields(markdown)` and return
  `{ beds?, baths?, sqft?, zestimate? }` where:
  - `beds`, `baths`, `zestimate` are kept as **strings** (matches `ZillowData` and how
    Sheriff/Legal store them; avoids the lossy `parseMoney("$1.2M") → 1.2` trap).
  - `sqft` is parsed to a **number** via `parseMoney` (the `properties.sqft` column is a
    number; `parseMoney("1,234 sqft") → 1234`).
  - Fields Zillow didn't surface are simply omitted.

### 2. Schema — `convex/schema.ts`

Add one column to `properties`: `zestimate: v.optional(v.string())`. Backward-compatible
(optional), no migration.

### 3. Fill-only-empty mutation — `convex/propertyData.ts → applyZillowFacts` (internalMutation)

Args: `{ id, beds?, baths?, sqft?, zestimate? }`. Loads the property and patches **only
the boxes that are currently empty**:

- `if (!p.beds && beds) patch.beds = beds` (same for `baths`, `zestimate`).
- `if (p.sqft == null && sqft != null) patch.sqft = sqft`.
- If nothing to fill, do nothing. Otherwise patch + bump `updatedAt`.

This is what makes the rule "never clobber": Sheriff/Legal seeds keep their beds/baths,
and anything the user typed is preserved. `zestimate` (brand-new column) fills for
everyone on first scrape.

### 4. Wire into the existing action — `convex/propertyActions.ts → scrapePropertyImage`

Inside the existing `try` block (right after the scrape, where `markdown`/`rawHtml`
are already in hand), compute `const facts = pickZillowFacts(markdown, rawHtml)` and, if
non-null and non-empty, `await ctx.runMutation(internal.propertyData.applyZillowFacts, { id, ...facts })`.
The image logic is untouched. A scrape that throws (block/timeout) → no facts (fine).

Because this action runs on **every** create (manual + sheriff/legal/flip seeds) **and**
on the "Refresh photo from Zillow" button, the fill-only-empty rule gives the agreed
behavior everywhere with no `source`-specific branching:

- **Manual add:** all boxes empty → all get filled.
- **Seeded add:** existing beds/baths kept; sqft/zestimate filled if the seed lacked them.
- **Refresh button:** re-pulls the photo and fills any still-empty box; never overwrites.
  (Trade-off the user accepted: a Zestimate, once set, won't auto-update month to month.)

### 5. Detail page — `src/web/PropertyDetail.tsx`

- Add a **"Zestimate"** text box to the existing facts grid, next to Sqft — editable and
  saved exactly like Beds/Baths/Sqft (`zestimate` state, included in `saveFacts`).
- The existing Beds/Baths/Sqft boxes need **no UI change** — they already render
  `p.beds`/`p.baths`/`p.sqft`, which now arrive pre-filled.
- `updateProperty` gains `zestimate: v.optional(v.union(v.string(), v.null()))` in its
  patch, handled the same `"zestimate" in patch` way as the other nullable fields.

**Cards (`Properties.tsx`): unchanged** — the user pointed at the detail page.

## Out of scope

- No card-grid changes. No card Zestimate.
- No "overwrite latest from Zillow" refresh button (the user chose fill-only-empty).
- No change to Sheriff/Legal/Flip pipelines, `deal.ts`, `enrich.ts`, or the image logic.

## Testing

- Unit tests for `pickZillowFacts` in `tests/zillow.test.ts`:
  - DE-match markdown with all four facts → returns `{ beds, baths, sqft:number, zestimate }`.
  - Non-DE homedetails URL (e.g. `-PA-`) → `null` (trust gate).
  - No homedetails URL in markdown/rawHtml → `null`.
  - DE match but sparse markdown → returns only the fields present.
- `extractFields` itself is already covered; reused as-is.
- Build/typecheck: `npx convex dev --once` (regen `_generated`) then `npm run build`;
  full `npm test` green.

## Files touched

- `src/scraper/zillow.ts` — add `pickZillowFacts` (+ import `parseMoney`).
- `tests/zillow.test.ts` — add `pickZillowFacts` cases.
- `convex/schema.ts` — `properties.zestimate`.
- `convex/propertyData.ts` — `applyZillowFacts` internalMutation; `zestimate` in
  `updateProperty` patch.
- `convex/propertyActions.ts` — call `pickZillowFacts` + `applyZillowFacts` in
  `scrapePropertyImage`.
- `src/web/PropertyDetail.tsx` — Zestimate box + state + save wiring.
