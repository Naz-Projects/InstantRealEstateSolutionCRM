export const MONITOR = {
  regionId: 2986, regionType: 4, // New Castle County, DE
  priceCeiling: 500000, minListPrice: 1000, dozDays: "7", sort: "days",
  spreadThreshold: 0.15, flipMarginBar: 0.12, capRateBar: 0.06, distressScoreFloor: 30,
  keeperRetireDays: 30, // keepers older than this age off the /monitor board (archivedAt)
  // Firecrawl v2 cache: first attempt accepts a page cached <= 1h; retries force a live
  // scrape (maxAge 0). Unset, v2 defaults to a 2-day cache (lessons 2026-10-03).
  scrapeMaxAgeMs: 60 * 60 * 1000,
  ncc_bounds: { west: -75.97218944726562, east: -75.22237255273437, south: 39.36230086205304, north: 39.76777058263119 },
} as const;

export function buildSearchUrl({ page }: { page?: number } = {}): string {
  const sqs = {
    pagination: page && page > 1 ? { currentPage: page } : {},
    isMapVisible: false,
    mapBounds: MONITOR.ncc_bounds,
    regionSelection: [{ regionId: MONITOR.regionId, regionType: MONITOR.regionType }],
    filterState: { sort: { value: MONITOR.sort }, doz: { value: MONITOR.dozDays }, price: { max: MONITOR.priceCeiling } },
    isListVisible: true,
  };
  return "https://www.zillow.com/new-castle-county-de/?searchQueryState=" + encodeURIComponent(JSON.stringify(sqs));
}

export function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export interface SearchListing {
  zpid: string; price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  ppsf: number | null; status: string; homeType?: string; daysOnZillow?: number;
  zestimate: number | null; zestSpreadPct: number | null; address: string; zip?: string;
  lat?: number; lng?: number; isNewConstruction: boolean; isZillowOwned: boolean; url: string;
}
export function totalResultCount(nextData: any): number | null {
  return nextData?.props?.pageProps?.searchPageState?.cat1?.searchList?.totalResultCount ?? null;
}
export function listingsFromSearch(nextData: any): SearchListing[] {
  const lr = nextData?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults ?? [];
  return lr.map((c: any): SearchListing => {
    const hi = c.hdpData?.homeInfo ?? {};
    const price = c.unformattedPrice ?? hi.price ?? null;
    const sqft = c.area ?? hi.livingArea ?? null;
    const zest = c.zestimate ?? hi.zestimate ?? null;
    const url = c.detailUrl ?? "";
    return {
      zpid: String(c.zpid), price, beds: c.beds ?? hi.bedrooms ?? null, baths: c.baths ?? hi.bathrooms ?? null,
      sqft, ppsf: price && sqft ? Math.round(price / sqft) : null,
      status: c.marketingStatusSimplifiedCd || c.statusText || c.statusType || "",
      homeType: hi.homeType, daysOnZillow: hi.daysOnZillow, zestimate: zest,
      zestSpreadPct: zest && price ? +(((zest - price) / zest) * 100).toFixed(1) : null,
      address: c.address ?? "", zip: c.addressZipcode, lat: c.latLong?.latitude, lng: c.latLong?.longitude,
      isNewConstruction: !!(c.builderName || c.isPaidBuilderNewConstruction) || /\/community\//.test(url),
      isZillowOwned: !!c.isZillowOwned, url,
    };
  });
}

export interface ListingDetail {
  description: string; homeType?: string; homeStatus?: string; yearBuilt: number | null;
  zestimate: number | null; rentZestimate: number | null; lastSoldPrice: number | null; dateSold: string | null;
  monthlyHoaFee: number | null; foreclosure: boolean; daysOnZillow: number | null; mlsId?: string;
  agentName?: string; agentPhone?: string; brokerName?: string; lotSize: number | null;
  priceHistory: { date?: string; event?: string; price?: number; ppsf?: number }[]; photoUrls: string[];
}
export function detailFromCache(nextData: any): ListingDetail | null {
  const cc = nextData?.props?.pageProps?.componentProps?.gdpClientCache;
  if (!cc) return null;
  let cache: any; try { cache = JSON.parse(cc); } catch { return null; }
  const key = Object.keys(cache).find((k) => cache[k] && cache[k].property);
  if (!key) return null;
  const p = cache[key].property;
  const ai = p.attributionInfo ?? {};
  const photos = (p.responsivePhotos ?? p.originalPhotos ?? [])
    .map((ph: any) => ph?.mixedSources?.jpeg?.[0]?.url ?? ph?.url).filter(Boolean).slice(0, 8);
  return {
    description: p.description ?? "", homeType: p.homeType, homeStatus: p.homeStatus,
    yearBuilt: p.resoFacts?.yearBuilt ?? null, zestimate: p.zestimate ?? null, rentZestimate: p.rentZestimate ?? null,
    lastSoldPrice: p.lastSoldPrice ?? null, dateSold: p.dateSoldString ?? null, monthlyHoaFee: p.monthlyHoaFee ?? null,
    foreclosure: !!(p.isPreforeclosureAuction || (p.foreclosureTypes && Object.values(p.foreclosureTypes).some(Boolean))),
    daysOnZillow: p.daysOnZillow ?? null, mlsId: ai.mlsId, agentName: ai.agentName,
    agentPhone: ai.agentPhoneNumber ?? ai.agentPhone, brokerName: ai.brokerName, lotSize: p.lotSize ?? p.lotAreaValue ?? null,
    priceHistory: (p.priceHistory ?? []).slice(0, 6).map((h: any) => ({ date: h.date, event: h.event, price: h.price, ppsf: h.pricePerSquareFoot })),
    photoUrls: photos,
  };
}

import { selectComps, suggestArv, type Comp } from "./comps";
import { estimateRehab, computeFlip, FLIP_DEFAULTS, type FlipAssumptions } from "./flip";
export { estimateRehab };

// Vacant land: house comps/rehab/rental math are meaningless on it, so land is
// never underwritten or kept (it stays visible in "All new", honestly labeled).
export function isLandType(homeType: string | null | undefined): boolean {
  const t = (homeType || "").trim().toUpperCase();
  return t === "LOT" || t === "LAND";
}

// Apartment buildings / multi-family: not the wholesaling target (SFR/townhouse/
// condo deals), so they are filtered out at scan AND vetoed at analysis.
export function isMultiUnitType(homeType: string | null | undefined): boolean {
  const t = (homeType || "").trim().toUpperCase().replace(/_/g, "");
  return t.startsWith("MULTIFAMILY") || t.startsWith("APARTMENT");
}

// Condo/co-op units (mostly units inside apartment buildings): HOA + financing
// constraints kill the wholesale exits, and their comps-based ARV is house-biased
// (fake spreads). Excluded per user decision 2026-08-08.
export function isCondoType(homeType: string | null | undefined): boolean {
  const t = (homeType || "").trim().toUpperCase().replace(/_/g, "");
  return t === "CONDO" || t === "CONDOMINIUM" || t.startsWith("COOP");
}

// Digest recipients: every active CRM user + the RESEND_TO fallback, deduped
// case-insensitively; blanks/non-emails dropped. [] = nothing to send to.
export function digestRecipients(userEmails: Array<string | null | undefined>, fallback?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of [...userEmails, fallback]) {
    const t = (e || "").trim();
    if (!t || !t.includes("@")) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function conservativeArv(opts: { comps: Comp[]; sqft: number | null; beds: number | null; zestimate: number | null; homeType?: string; }):
  { arv: number | null; source: "comps" | "zestimate" | "none"; compsPpsf: number | null; compsCount: number } {
  const manufactured = (opts.homeType || "").toUpperCase() === "MANUFACTURED";
  if (manufactured) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  const sel = selectComps(opts.comps, { sqft: opts.sqft, beds: opts.beds });
  const sug = suggestArv(sel, opts.sqft);
  if (sug.arv == null) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  let arv = sug.arv;
  if (opts.zestimate && arv > opts.zestimate * 1.15) arv = Math.round(opts.zestimate * 1.15); // cap inflated comps
  return { arv, source: "comps", compsPpsf: sug.pricePerSqft, compsCount: sug.count };
}

const GUT = /fire|flood|gut|shell|structural|severe|full rehab|full renovation|complete renovation|tear down|needs everything/i;
const COSMETIC = /updated|renovated|remodel|move.?in|turn.?key|shows like new|refreshed|pride of ownership|new (kitchen|roof|hvac|appliances)/i;
const MODERATE = /needs? (work|updating|tlc|repairs|renovation)|\bdated\b|handyman|investor|value.?add|personal touch|bring your (vision|contractor|imagination)|fixer|sold (strictly )?as.?is|cash only|may not qualify/i;
export function inferRehabTier(description: string): "cosmetic" | "moderate" | "gut" {
  const d = description || "";
  if (GUT.test(d)) return "gut";
  if (COSMETIC.test(d) && !MODERATE.test(d)) return "cosmetic";
  return "moderate";
}

// Explicit ALREADY-DONE renovation language (someone else already flipped it) —
// stricter than COSMETIC so a fixer isn't mislabeled. Needs-work language wins:
// a description with both ("renovated kitchen but needs TLC") is NOT renovated,
// mirroring inferRehabTier's MODERATE/GUT precedence.
const RENOVATED_STRONG = /(fully|newly|completely|totally|beautifully|recently|freshly|tastefully|professionally)[\s-]+(renovated|remodeled|rehabbed|updated)|(?<!needs?\s|being\s|partially\s|unfinished\s|mid[\s-]?)\b(renovated|remodeled|rehabbed)\b(?!\s+(opportunity|project|potential|ideas))|updated throughout|(new|updated) kitchen|(new|updated) bath(room)?s?|turn[\s-]?key|shows like new|like[\s-]new condition|nothing to do but move in/i;
export function detectRenovated(description: string | null | undefined): boolean {
  const d = description || "";
  return RENOVATED_STRONG.test(d) && !MODERATE.test(d) && !GUT.test(d);
}

export interface RentalMetrics { rent: number; onePct: number; capRate: number; cashFlow: number; cashOnCash: number; allIn: number; }

// NCC/Delaware transfer-tax correction, applied ONLY to the monitor's underwriting
// (the standalone /flip Analyzer keeps FLIP_DEFAULTS' generic math). Research
// docs/superpowers/research/2026-07-04-flipper-criteria.md §1.15 + §1.2: NCC transfer
// tax is 4% total, customarily split 50/50 -> the investor pays ~2% of purchase when
// BUYING and ~2% of resale (ARV) when SELLING. The BASE assumptions already carry the
// ~2% SELL-leg (seller) portion as sellTransferPct (see flip.ts); the generic closingPct
// is a pure purchase-closing rate with NO transfer component, so the monitor adds only
// the missing BUY leg (+0.02 of purchase on closingPct). This lowers flip profit/margin/roi
// by the buy-side transfer tax (analyzeFlip additionally replaces computeFlip's generic
// 70%-rule MAO with the NCC-corrected closed form below).
export const MONITOR_FLIP_ASSUMPTIONS: FlipAssumptions = {
  ...FLIP_DEFAULTS.assumptions,
  closingPct: FLIP_DEFAULTS.assumptions.closingPct + 0.02,
};
export function analyzeFlip(arv: number | null, list: number | null, rehab: number) {
  if (arv == null || list == null) return null;
  const m = computeFlip({ arv, purchasePrice: list, rehabTotal: rehab, assumptions: MONITOR_FLIP_ASSUMPTIONS });
  // NCC-corrected MAO (research §1.2/§1.15): the offer ceiling must absorb BOTH transfer-tax
  // legs — solve P + 0.02·P (buy leg) + rehab + 0.02·ARV (sell leg) = 0.70·ARV
  // => P = (0.68·ARV − rehab) / 1.02, an effective ~66.7% rule (inside the NCC 65–68% band).
  const nccMao = Math.round((0.68 * arv - rehab) / 1.02);
  return { mao: nccMao, profit: m.profit, margin: m.margin ?? 0, roi: m.roi, roomVsList: nccMao - list };
}
export function analyzeRental({ rent, list, rehab, taxRatePct }: { rent: number | null; list: number; rehab: number; taxRatePct?: number }): RentalMetrics | null {
  if (!rent || !list) return null;
  const allIn = list + (rehab || 0);
  const taxMo = (list * ((taxRatePct ?? 1.6) / 100)) / 12, ins = 95, opVar = 0.25 * rent;
  const noiMo = rent - taxMo - ins - opVar;
  const r = 0.075 / 12, loan = 0.75 * allIn, pi = loan * r / (1 - (1 + r) ** -360);
  const cashFlow = noiMo - pi, capRate = (noiMo * 12) / allIn;
  const invested = 0.25 * allIn + 0.03 * list;
  return { rent, onePct: rent / list, capRate, cashFlow: Math.round(cashFlow), cashOnCash: (cashFlow * 12) / invested, allIn };
}
export function scoreDeal(flip: any, rental: RentalMetrics | null) {
  const flipScore = !flip || flip.margin == null ? 0 : flip.margin >= 0.2 ? 90 : flip.margin >= 0.15 ? 75 : flip.margin >= 0.1 ? 60 : flip.margin >= 0.05 ? 40 : flip.margin > 0 ? 20 : 0;
  const rentScore = !rental ? 0 : rental.capRate >= 0.08 ? 90 : rental.capRate >= 0.06 ? 72 : rental.capRate >= 0.05 ? 55 : rental.capRate >= 0.04 ? 40 : 20;
  const dealScore = Math.max(flipScore, rentScore);
  const bestExit = dealScore < 35 ? "PASS" : flipScore >= rentScore ? "FLIP" : "RENTAL";
  return { flipScore, rentScore, dealScore, bestExit } as const;
}
export function decideKeeper({ belowMarket, flip, rental, distress, spread, dealScore }: { belowMarket: boolean; flip?: any; rental?: any; distress: boolean; spread: number | null; dealScore: number }): boolean {
  if (belowMarket) return true;
  if (flip && flip.margin != null && flip.margin >= MONITOR.flipMarginBar) return true;
  if (rental && rental.capRate != null && rental.capRate >= MONITOR.capRateBar) return true;
  // distress (an LLM/foreclosure tag) never keeps a listing whose economics are negative
  if (distress) return (spread != null && spread >= 0) || dealScore >= MONITOR.distressScoreFloor;
  return false;
}
export function riskFlags(r: { homeType?: string; monthlyHoaFee?: number | null; description?: string; rehabTier?: string; zestimate?: number | null; compsArv?: number | null; detailOk?: boolean }): string[] {
  const f: string[] = [];
  if ((r.homeType || "").toUpperCase() === "MANUFACTURED") f.push("MANUFACTURED (comps/lot-rent suspect)");
  if (r.monthlyHoaFee && r.monthlyHoaFee > 250) f.push("HIGH-HOA $" + r.monthlyHoaFee + "/mo");
  if (/may not qualify|cash only|\bFHA\b|\bVA\b/i.test(r.description || "")) f.push("non-financeable (cash)");
  if (r.rehabTier === "gut") f.push("heavy-rehab");
  if (r.zestimate && r.compsArv && r.compsArv > r.zestimate * 1.5) f.push("comps>>Zestimate (ARV suspect)");
  if (r.detailOk === false) f.push("detail-missing (VERIFY)");
  return f;
}

// v2 analyst verdict: the legacy keep/match/condition fields PLUS a structured
// condition/exit breakdown (research §2 lexicon + §5 exit triage). All new fields
// are nullable/empty-defaulted so a missing/garbage LLM field never throws.
export interface JudgeVerdict {
  keep: boolean;
  matchedRequirements: string[];
  conditionNotes: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  renovated: boolean;
  conditionTier: "cosmetic" | "moderate" | "systems" | "structural" | null;
  valueAddScope: string | null;   // ≤300 chars
  redFlags: string[];
  verifyGates: string[];
  exitTriage: "FLIP" | "WHOLETAIL" | "RENTAL" | "WHOLESALE" | "PASS" | null;
  exitFallbacks: string[];
  breakdown: string | null;        // ≤900 chars — the analyst narrative
}
const REQS = ["below_market", "fixer", "distressed", "flip"];
const CONDITION_TIERS = ["cosmetic", "moderate", "systems", "structural"] as const;
const EXIT_TRIAGE = ["FLIP", "WHOLETAIL", "RENTAL", "WHOLESALE", "PASS"] as const;

// Compact GIVEN/pre-computed deal-signals block (Task 1's DealSignals). Every
// number here is deterministic — the judge must NOT recompute it. Omitted when
// rec.dealSignals is absent (VERIFY / detail-missing rows).
function dealSignalsBlock(rec: any): string {
  const ds = rec.dealSignals;
  if (!ds) return "dealSignals: n/a";
  const pct = (n: any) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "n/a");
  return `dealSignals (GIVEN — pre-computed, DO NOT recompute):
  motivationPoints: ${ds.motivationPoints ?? "n/a"} (cap 10)
  motivationSignals: ${(ds.motivationSignals ?? []).join(", ") || "none"}
  ppsfDiscountVsComps: ${pct(ds.ppsfDiscountPct)}
  daysOnMarket: ${ds.domDays ?? "n/a"} (${ds.domBucket ?? "n/a"})
  priceCuts: ${ds.cutCount ?? 0} cut(s), depth ${pct(ds.cutDepthPct)}
  ownerTenureYears: ${ds.tenureYears != null ? Math.round(ds.tenureYears) : "n/a"} (${ds.tenureSignal ?? "n/a"})
  eraHazards: ${(ds.eraHazards ?? []).join(", ") || "none"}
  zipTier: ${ds.zipTier ?? "n/a"}
  photoSignal: ${ds.photoSignal ?? "n/a"}
  backOnMarket: ${ds.backOnMarket ? "yes" : "no"}`;
}

export function buildJudgePrompt(rec: any): string {
  return `You are a real-estate investment analyst for a New Castle County, DE flipping/rental firm. Judge whether this NEW listing is a deal worth surfacing. Keep it if it meets ANY of: (1) below_market (listed materially under value — the spread is ALREADY COMPUTED below), (2) fixer (needs renovation), (3) distressed (motivated/estate/foreclosure/as-is/must-sell), (4) flip (margin after rehab). DO NOT recompute any numbers — every number below is GIVEN, use it as-is; never recompute the spread, margin, cap rate, $/sqft, or signals.

RUBRIC (condense the description against this; the numbers are already computed):
CONDITION TIERS (route the value-add):
- cosmetic: dated · original / all original · needs updating · well-maintained · paint/carpet only.
- moderate: needs TLC / needs work · fixer / handyman/contractor special · investor special · good/great potential · diamond in the rough · value-add · sweat equity (the classic flip band).
- systems: good bones + deferred maintenance · mechanicals · roof leak/end-of-life · HVAC/electrical/plumbing/rewire.
- structural: foundation/settling/bowing · gut · tear-down / lot value · mold · fire/water damage · uninhabitable · vandalized.
EUPHEMISM DECODER: cozy/quaint/dollhouse=small · charming/character=old, needs work · rustic=poorly maintained · unique/custom/quirky=resale risk · heavy location/view talk=house underwhelms · updated/refreshed w/o specifics=maybe just paint.
RETAIL/RENOVATED (NEGATIVE — reduces): turn-key · move-in ready · fully/newly/recently renovated/remodeled/updated · updated throughout · new kitchen/bath/roof/HVAC · granite/quartz/stainless · immaculate/pristine/mint. These mean someone ALREADY did the flip.
EXIT TRIAGE (pick best-fit exitTriage + list exitFallbacks[]; score all, never one):
- WHOLETAIL: livable & financeable AS-IS, only cosmetic (trash-out/clean/paint), meaningful spread. Estate/tenure signals + decent photos + no system red flags.
- FLIP: moderate/systems condition lifting ARV well beyond cost; both profit floors clear; 3–6mo hold.
- RENTAL: big as-is→ARV gap AND rents hold (DSCR); Wilmington-city ZIPs bias rental/BRRRR.
- WHOLESALE: thin margin — assign the contract ($5–20K).
- PASS: none clears.

Return ONLY json of EXACTLY this shape:
{"keep":true,"matchedRequirements":["fixer","distressed"],"renovated":false,"conditionTier":"moderate","valueAddScope":"...","redFlags":[],"verifyGates":[],"exitTriage":"FLIP","exitFallbacks":["WHOLETAIL"],"breakdown":"...","confidence":"high","conditionNotes":"...","reason":"one sentence <=200 chars"}
Rules: conditionTier ∈ {cosmetic,moderate,systems,structural}; exitTriage ∈ {FLIP,WHOLETAIL,RENTAL,WHOLESALE,PASS}; valueAddScope ≤300 chars (the specific scope of work / value-add play); breakdown ≤900 chars (the analyst narrative tying signals→condition→exit); redFlags/verifyGates/exitFallbacks are short string arrays; renovated:true ONLY if the home was ALREADY renovated/remodeled/turnkey (someone else did the flip); missing/unknown → use null (do not fabricate).
Listing:
address: ${rec.address ?? "n/a"}
listPrice: ${rec.listPrice ?? "n/a"}
conservativeARV: ${rec.conservativeArv ?? "n/a"}
belowMarketSpread%: ${rec.spreadPct ?? "n/a"}
rehabTier(estimated): ${rec.rehabTier ?? "n/a"}
flipMargin%: ${rec.flipMarginPct ?? "n/a"}
rentalCapRate%: ${rec.capRatePct ?? "n/a"}
homeType: ${rec.homeType ?? "n/a"}
yearBuilt: ${rec.yearBuilt ?? "n/a"}
photoCount: ${rec.photoCount ?? "n/a"}
lastSoldPrice: ${rec.lastSoldPrice ?? "n/a"}
lastSoldDate: ${rec.lastSoldDate ?? "n/a"}
daysOnMarket: ${rec.daysOnMarket ?? "n/a"}
priceHistory: ${rec.priceHistoryCompact ?? "n/a"}
${dealSignalsBlock(rec)}
description: """${(rec.description || "").slice(0, 1500)}"""`;
}
export function parseJudgeResponse(raw: string): JudgeVerdict | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  let obj: any; try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (typeof obj.keep !== "boolean") return null;
  const matched = Array.isArray(obj.matchedRequirements) ? obj.matchedRequirements.filter((x: any) => REQS.includes(x)) : [];
  const conf = ["low", "medium", "high"].includes(obj.confidence) ? obj.confidence : "low";
  const conditionTier = CONDITION_TIERS.includes(obj.conditionTier) ? obj.conditionTier : null;
  const exitTriage = EXIT_TRIAGE.includes(obj.exitTriage) ? obj.exitTriage : null;
  const valueAddScope = typeof obj.valueAddScope === "string" && obj.valueAddScope.trim() ? String(obj.valueAddScope).slice(0, 300) : null;
  const breakdown = typeof obj.breakdown === "string" && obj.breakdown.trim() ? String(obj.breakdown).slice(0, 900) : null;
  const strArr = (x: any): string[] =>
    Array.isArray(x) ? x.filter((v: any) => typeof v === "string" && v.trim()).map((v: string) => v.slice(0, 120)).slice(0, 12) : [];
  return {
    keep: obj.keep,
    matchedRequirements: matched,
    conditionNotes: String(obj.conditionNotes ?? "").slice(0, 500),
    reason: String(obj.reason ?? "").slice(0, 240),
    confidence: conf,
    renovated: obj.renovated === true,
    conditionTier,
    valueAddScope,
    redFlags: strArr(obj.redFlags),
    verifyGates: strArr(obj.verifyGates),
    exitTriage,
    exitFallbacks: strArr(obj.exitFallbacks),
    breakdown,
  };
}
