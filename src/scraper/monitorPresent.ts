// Shared, pure presentation rules for the /monitor board AND the nightly digest
// email, so the page and the email always say the same thing. No React, no Convex.
// Spec: docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md (Design Direction).

import { classifyEvent } from "./dealSignals";

export type Exit = "FLIP" | "RENTAL" | "WHOLESALE" | "PASS";
export type Tone = "pos" | "neg" | "neutral";

type N = number | null;
type S = string | null;
export interface PresentRow {
  bestExit?: S; listPrice?: N; flipMao?: N; roomVsList?: N; flipMargin?: N;
  cashFlow?: N; dscr?: N; capRate?: N; spread?: N; zestimate?: N; asIsValue?: N;
  conservativeArv?: N; rehabEstimate?: N; rentZestimate?: N; leaseRent?: N; brrrrCashLeftIn?: N;
  dealScore?: N; exitTriage?: S; aiReason?: S; redFlags?: string[] | null; riskFlags?: string[] | null;
  offMarketSignals?: string[] | null; offMarketBalances?: N; offMarketConditionScore?: N;
}

export const MINUS = "−"; // typographic minus for signed money

const ok = (n: N | undefined): n is number => n != null && Number.isFinite(n);

export function money(n: N | undefined): string {
  if (!ok(n)) return "—";
  const r = Math.round(n);
  return `${r < 0 ? MINUS : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}
export function signedMoney(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "$0";
  return `${r > 0 ? "+" : MINUS}$${Math.abs(r).toLocaleString("en-US")}`;
}
export function pct1(fraction: N | undefined): string {
  return ok(fraction) ? `${(fraction * 100).toFixed(1)}%` : "—";
}
export function toneOf(n: N | undefined): Tone {
  if (!ok(n) || Math.round(n) === 0) return "neutral";
  return n > 0 ? "pos" : "neg";
}

const EXITS: readonly Exit[] = ["FLIP", "RENTAL", "WHOLESALE", "PASS"];
export function normalizeExit(s: S | undefined): Exit | null {
  const u = (s ?? "").toUpperCase();
  return (EXITS as readonly string[]).includes(u) ? (u as Exit) : null;
}
export function exitLabel(s: string): string {
  const w = s.trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// The below-market spread basis (Phase 1): the Zestimate when present, else the
// comps as-is value. Never "ARV".
export function spreadBasisLabel(r: Pick<PresentRow, "zestimate">): "Zestimate" | "as-is value" {
  return ok(r.zestimate) && r.zestimate > 0 ? "Zestimate" : "as-is value";
}

export interface Verdict { value: string; caption: string; tone: Tone; sortKey: number | null }
const NO_VERDICT: Verdict = { value: "—", caption: "", tone: "neutral", sortKey: null };

// The ONE deciding number for the row's bestExit (the board's verdict cell).
export function verdictFor(r: PresentRow): Verdict {
  const exit = normalizeExit(r.bestExit);
  if (exit === "FLIP" && ok(r.roomVsList)) {
    return { value: signedMoney(r.roomVsList), caption: `max offer ${money(r.flipMao)}`, tone: toneOf(r.roomVsList), sortKey: r.roomVsList };
  }
  if (exit === "RENTAL" && ok(r.cashFlow)) {
    return { value: `${signedMoney(r.cashFlow)}/mo`, caption: `DSCR ${ok(r.dscr) ? r.dscr.toFixed(2) : "—"}`, tone: toneOf(r.cashFlow), sortKey: r.cashFlow };
  }
  if (exit === "WHOLESALE" && ok(r.spread)) {
    return { value: signedMoney(r.spread), caption: `vs ${spreadBasisLabel(r)}`, tone: toneOf(r.spread), sortKey: r.spread };
  }
  return NO_VERDICT;
}

// Raw slugs the judge echoes from its GIVEN dealSignals block, era hazards, and the
// pipeline's riskFlags -> plain labels. Unknown slugs become words; free text keeps
// its wording with the first letter capitalized.
const FLAG_LABELS: Record<string, string> = {
  sparse_photos: "Few listing photos",
  retail_staging: "Staged for retail buyers",
  "city-high-risk": "Wilmington city ZIP (higher risk)",
  "suburb-standard": "Standard suburban ZIP",
  "suburb-premium": "Premium suburban ZIP",
  lead_paint_pre1978: "Lead paint era (pre-1978)",
  asbestos_era_pre1980: "Asbestos era (pre-1980)",
  knob_tube_era_pre1940: "Knob and tube wiring era (pre-1940)",
  aluminum_wiring_era_1965_75: "Aluminum wiring era (1965-75)",
  polybutylene_era_1978_95: "Polybutylene plumbing era (1978-95)",
  oil_tank_risk_pre1975: "Possible buried oil tank (pre-1975)",
  long_tenure_equity: "Long-time owner with equity",
  recent_purchase_flag: "Bought recently",
  underwater: "Owner may be underwater",
  priced_below_appreciation: "Priced below expected appreciation",
  thin_margin_resale: "Thin resale margin",
  "heavy-rehab": "Heavy rehab",
  "non-financeable (cash)": "Cash buyers only",
  "detail-missing (VERIFY)": "Listing details missing",
  "sqft-missing (VERIFY)": "Square footage unknown",
  "comps>>Zestimate (ARV suspect)": "Comps far above Zestimate (ARV suspect)",
  "RENOVATED (no flip)": "Already renovated",
};
const KEY_PREFIX = /^(?:zipTier|photoSignal|eraHazards?|tenureSignal|vsAppreciation|domBucket)\s*[:=]\s*/i;
const REWRITES: Array<[RegExp, string]> = [
  [/^LEASED at /i, "Leased at "],
  [/^HIGH-HOA /i, "High HOA "],
  [/^MANUFACTURED\b.*$/i, "Manufactured home (comps suspect)"],
];
const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function humanizeFlag(raw: string): string {
  const s = raw.trim().replace(KEY_PREFIX, "");
  if (FLAG_LABELS[s]) return FLAG_LABELS[s];
  for (const [re, to] of REWRITES) if (re.test(s)) return s.replace(re, to);
  const noVerify = s.replace(/\s*\(VERIFY\)$/i, "");
  if (SLUG.test(noVerify) && !/\s/.test(noVerify)) return cap(noVerify.replace(/[_-]+/g, " ").toLowerCase());
  return cap(noVerify);
}

// Judge red flags first (most specific), then pipeline flags; humanized, de-duplicated.
export function displayFlags(r: Pick<PresentRow, "redFlags" | "riskFlags">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [...(r.redFlags ?? []), ...(r.riskFlags ?? [])]) {
    const h = humanizeFlag(f);
    const k = h.toLowerCase();
    if (h && !seen.has(k)) { seen.add(k); out.push(h); }
  }
  return out;
}

// Security S25-3: only http(s) URLs may become an href/src.
export function safeHref(u: string | null | undefined): string | undefined {
  if (typeof u !== "string") return undefined;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : undefined;
}

// A "." after one of these does not end a sentence ("Est. ARV $240k").
const ABBREV_END = /(?:^|[\s(])(?:est|approx|vs|st|no|ave|rd|dr|mr|mrs|ms|jr|sr|e\.g|i\.e)\.$/i;
function firstSentence(t: string): string {
  const end = /[.!?](?=\s|$)/g;
  for (let m = end.exec(t); m; m = end.exec(t)) {
    const head = t.slice(0, m.index + 1);
    if (m[0] !== "." || !ABBREV_END.test(head)) return head;
  }
  return t;
}

// ~50 chars of 13px text fit one line of the 390px email card (about 330px of content).
export function oneLineReason(s: string | null | undefined, max = 55): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  const head = firstSentence(t);
  const first = head.length < 12 ? t : head;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

// The LLM's exit read, only when it disagrees with the deterministic bestExit on a
// deal strong enough to matter (score >= 50).
export function analystNote(r: Pick<PresentRow, "bestExit" | "exitTriage" | "dealScore">): string | null {
  if (!r.exitTriage || !r.bestExit) return null;
  if (r.exitTriage.toUpperCase() === r.bestExit.toUpperCase()) return null;
  if (!ok(r.dealScore) || r.dealScore < 50) return null;
  return `Analyst leans ${exitLabel(r.exitTriage)}`;
}

// The off-market moat: only a real distress signal counts (a bare parcel match is not one).
export function ownerSignal(r: Pick<PresentRow, "offMarketSignals" | "offMarketBalances" | "offMarketConditionScore">): string | null {
  const sig = r.offMarketSignals ?? [];
  if (sig.length) return sig.map((s) => cap(s.replace(/[_-]+/g, " "))).join(", ");
  if (ok(r.offMarketBalances)) return `Delinquent balances ${money(r.offMarketBalances)}`;
  if (ok(r.offMarketConditionScore)) return `Condition score ${r.offMarketConditionScore}`;
  return null;
}

// ── Seller motivation (deal sheet) ──
// "cut" = a price cut (good news for a buyer, shown amber, never the red negative tone).
export interface HistoryRow { date: string; event: string; price: string; change: string | null; tone: "cut" | "neutral" }

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function fmtDate(d: unknown): string {
  if (typeof d !== "string" && typeof d !== "number") return "—";
  const ms = typeof d === "number" ? d : Date.parse(d);
  return Number.isFinite(ms) ? dateFmt.format(ms) : String(d);
}

// priceHistory is stored as v.any() (scraped). Same cut rule as dealSignals: sort
// oldest first, compare each price change to the previous priced event; then show
// most recent first, capped at `max`.
export function priceHistoryRows(history: unknown, max = 6): HistoryRow[] {
  if (!Array.isArray(history)) return [];
  const evs = history
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => {
      const event = typeof h.event === "string" ? h.event.trim() : "";
      const price = typeof h.price === "number" && Number.isFinite(h.price) ? h.price : null;
      const ms = typeof h.date === "number" ? h.date : typeof h.date === "string" ? Date.parse(h.date) : NaN;
      return { event, price, date: h.date, ms: Number.isFinite(ms) ? ms : null };
    })
    .filter((e) => e.event || e.price != null)
    .sort((a, b) => (a.ms ?? -Infinity) - (b.ms ?? -Infinity));
  let prev: number | null = null;
  const rows = evs.map((e): HistoryRow => {
    let change: string | null = null;
    let tone: HistoryRow["tone"] = "neutral";
    let label = e.event ? cap(e.event) : "—";
    if (e.price != null && prev != null && classifyEvent(e.event) === "price_change" && e.price !== prev) {
      const d = e.price - prev;
      change = signedMoney(d);
      if (d < 0) tone = "cut";
      label = d < 0 ? "Price cut" : "Price increase";
    }
    if (e.price != null) prev = e.price;
    return { date: fmtDate(e.date), event: label, price: money(e.price), change, tone };
  });
  return rows.reverse().slice(0, max);
}

export interface MotivationFact { label: string; value: string }
export interface SellerMotivation { facts: MotivationFact[]; signals: string[]; history: HistoryRow[] }
export interface MotivationRow {
  priceHistory?: unknown; motivationPoints?: N; motivationSignals?: string[] | null;
  daysOnZillow?: N; tenureYears?: N; lastSoldPrice?: N; lastSoldDate?: S;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Plain-language motivation facts + the stored dealSignals phrases ("2 price cuts
// (-8%)", "back on market"). Cut count/depth and back-on-market live only in those
// phrases. Null when the row has nothing to show (old rows).
export function sellerMotivation(r: MotivationRow): SellerMotivation | null {
  const facts: MotivationFact[] = [];
  if (ok(r.motivationPoints)) facts.push({ label: "Score", value: `${r.motivationPoints}/10` });
  if (ok(r.daysOnZillow)) facts.push({ label: "On market", value: plural(Math.round(r.daysOnZillow), "day", "days") });
  const tenure = ok(r.tenureYears) ? Math.round(r.tenureYears) : null;
  if (tenure != null) facts.push({ label: "Owner tenure", value: plural(tenure, "yr", "yrs") });
  if (ok(r.lastSoldPrice)) {
    facts.push({ label: "Last sold", value: r.lastSoldDate ? `${money(r.lastSoldPrice)} · ${fmtDate(r.lastSoldDate)}` : money(r.lastSoldPrice) });
  }
  const signals = (r.motivationSignals ?? [])
    .filter((s) => typeof s === "string" && s.trim() && !(tenure != null && /^\d+-yr owner$/i.test(s.trim())))
    .map((s) => cap(s.trim().replace(/-(?=\d)/g, MINUS)));
  const history = priceHistoryRows(r.priceHistory);
  return facts.length || signals.length || history.length ? { facts, signals, history } : null;
}

export interface NumberCell { label: string; value: string; tone: Tone }
export interface NumberGroup { title: "Value" | "Flip" | "Rental"; cells: NumberCell[] }
const cell = (label: string, value: string, tone: Tone = "neutral"): NumberCell => ({ label, value, tone });

// The deal sheet's numbers grid. A group is omitted when it has no data.
export function numberGroups(r: PresentRow): NumberGroup[] {
  const groups: NumberGroup[] = [];
  if ([r.listPrice, r.asIsValue, r.conservativeArv, r.rehabEstimate].some(ok)) {
    groups.push({ title: "Value", cells: [
      cell("List", money(r.listPrice)), cell("As-is value", money(r.asIsValue)),
      cell("ARV", money(r.conservativeArv)), cell("Rehab", money(r.rehabEstimate)),
    ] });
  }
  if (ok(r.flipMao)) {
    groups.push({ title: "Flip", cells: [
      cell("Max offer", money(r.flipMao)),
      cell("Offer gap", ok(r.roomVsList) ? signedMoney(r.roomVsList) : "—", toneOf(r.roomVsList)),
      cell("Margin", pct1(r.flipMargin)),
    ] });
  }
  if (ok(r.capRate)) {
    const leaseBinds = ok(r.leaseRent) && (!ok(r.rentZestimate) || r.leaseRent <= r.rentZestimate);
    const rent = leaseBinds ? r.leaseRent : r.rentZestimate;
    const b = r.brrrrCashLeftIn;
    groups.push({ title: "Rental", cells: [
      cell(leaseBinds ? "Rent (lease)" : "Rent", ok(rent) ? `${money(rent)}/mo` : "—"),
      cell("Cap rate", pct1(r.capRate)),
      cell("Cash flow", ok(r.cashFlow) ? `${signedMoney(r.cashFlow)}/mo` : "—", toneOf(r.cashFlow)),
      cell("DSCR", ok(r.dscr) ? r.dscr.toFixed(2) : "—"),
      cell("BRRRR cash left in", !ok(b) ? "—" : b < 0 ? `${money(-b)} out` : money(b)),
    ] });
  }
  return groups;
}
