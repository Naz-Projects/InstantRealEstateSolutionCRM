// Phase 4 — per-user Monitor buy box: validation, matching, and per-recipient digest
// planning. Pure (no Convex): the mutation validates with normalizeBuyBox, sendDigest
// plans with planRecipientDigests. Empty list / unset bound = "any".
import { MONITOR, digestRecipients } from "./monitorListings";

export type BuyBoxExit = "FLIP" | "RENTAL";
export interface BuyBox {
  zips: string[];
  priceMin?: number;
  priceMax?: number;
  minBeds?: number;
  exits: BuyBoxExit[];
  minFlipProfit?: number;
  minCashFlow?: number;
}
export interface BuyBoxInput {
  zips: string[];
  priceMin?: number;
  priceMax?: number;
  minBeds?: number;
  exits: string[];
  minFlipProfit?: number;
  minCashFlow?: number;
}

// "19805, 19806 19711-1234" -> ["19805","19806","19711"]; ZIP+4 trimmed, dupes dropped,
// anything else reported (never silently dropped).
export function parseZipList(text: string): { zips: string[]; invalid: string[] } {
  const zips: string[] = [];
  const invalid: string[] = [];
  for (const tok of (text || "").split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d{5})(?:-\d{4})?$/);
    if (!m) { invalid.push(tok); continue; }
    if (!zips.includes(m[1])) zips.push(m[1]);
  }
  return { zips, invalid };
}

const NON_NEG = ["priceMin", "priceMax", "minBeds", "minFlipProfit"] as const;

export function normalizeBuyBox(i: BuyBoxInput): { ok: true; box: BuyBox } | { ok: false; error: string } {
  const zips: string[] = [];
  for (const z of i.zips) {
    const p = parseZipList(z);
    if (p.invalid.length) return { ok: false, error: `Not a 5-digit ZIP: ${p.invalid[0]}` };
    for (const x of p.zips) if (!zips.includes(x)) zips.push(x);
  }
  if (zips.length > MONITOR.buyBoxMaxZips) return { ok: false, error: `At most ${MONITOR.buyBoxMaxZips} ZIPs` };
  for (const k of NON_NEG) {
    const n = i[k];
    if (n != null && !(Number.isFinite(n) && n >= 0)) return { ok: false, error: "Numbers must be 0 or more (except min cash flow)" };
  }
  if (i.minCashFlow != null && !Number.isFinite(i.minCashFlow)) return { ok: false, error: "Min cash flow must be a number" };
  if (i.priceMin != null && i.priceMax != null && i.priceMin > i.priceMax) return { ok: false, error: "Min price is above max price" };
  const exits: BuyBoxExit[] = [];
  for (const e of i.exits) {
    if (e !== "FLIP" && e !== "RENTAL") return { ok: false, error: "Exits must be FLIP or RENTAL" };
    if (!exits.includes(e)) exits.push(e);
  }
  return {
    ok: true,
    box: {
      zips,
      ...(i.priceMin != null ? { priceMin: i.priceMin } : {}),
      ...(i.priceMax != null ? { priceMax: i.priceMax } : {}),
      ...(i.minBeds != null ? { minBeds: i.minBeds } : {}),
      exits,
      ...(i.minFlipProfit != null ? { minFlipProfit: i.minFlipProfit } : {}),
      ...(i.minCashFlow != null ? { minCashFlow: i.minCashFlow } : {}),
    },
  };
}

export function isEmptyBuyBox(b: BuyBox): boolean {
  return b.zips.length === 0 && b.exits.length === 0 && b.priceMin == null && b.priceMax == null &&
    b.minBeds == null && b.minFlipProfit == null && b.minCashFlow == null;
}

export interface BuyBoxRow {
  propZip?: string;
  address: string;
  listPrice?: number;
  beds?: number | string;
  bestExit?: string;
  flipProfit?: number;
  cashFlow?: number;
}
function rowZip(r: BuyBoxRow): string | null {
  return r.propZip ?? r.address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
}
function bedsNum(b: number | string | undefined): number | null {
  const n = typeof b === "number" ? b : parseFloat(b ?? "");
  return Number.isFinite(n) ? n : null;
}

export function matchesBuyBox(r: BuyBoxRow, box: BuyBox | null | undefined): boolean {
  if (!box) return true;
  if (box.zips.length) {
    const z = rowZip(r);
    if (!z || !box.zips.includes(z)) return false;
  }
  if (box.priceMin != null && !(r.listPrice != null && r.listPrice >= box.priceMin)) return false;
  if (box.priceMax != null && !(r.listPrice != null && r.listPrice <= box.priceMax)) return false;
  // Unknown beds pass: a card data gap must not hide a deal (the email shows what it has).
  if (box.minBeds != null) {
    const b = bedsNum(r.beds);
    if (b != null && b < box.minBeds) return false;
  }
  if (box.exits.length && !box.exits.includes(r.bestExit as BuyBoxExit)) return false;
  if (r.bestExit === "FLIP" && box.minFlipProfit != null && !(r.flipProfit != null && r.flipProfit >= box.minFlipProfit)) return false;
  if (r.bestExit === "RENTAL" && box.minCashFlow != null && !(r.cashFlow != null && r.cashFlow >= box.minCashFlow)) return false;
  return true;
}

export interface AudienceMember { email: string; box: BuyBox | null; }

// Who gets what: digestRecipients() keeps the existing who-is-active + dedupe rules; each
// recipient's rows = the digest set filtered by their own box (RESEND_TO fallback = no
// box = everything). Recipients with nothing matching are omitted (no empty email).
export function planRecipientDigests<T extends BuyBoxRow>(rows: T[], members: AudienceMember[], fallback?: string): { to: string; rows: T[] }[] {
  const boxByEmail = new Map<string, BuyBox | null>();
  for (const m of members) {
    const k = m.email.trim().toLowerCase();
    if (!boxByEmail.has(k)) boxByEmail.set(k, m.box); // first wins, like digestRecipients' dedupe
  }
  const out: { to: string; rows: T[] }[] = [];
  for (const to of digestRecipients(members.map((m) => m.email), fallback)) {
    const mine = rows.filter((r) => matchesBuyBox(r, boxByEmail.get(to.toLowerCase()) ?? null));
    if (mine.length) out.push({ to, rows: mine });
  }
  return out;
}

// emailedAt is GLOBAL ("digest processed"): stamp the set when at least one send
// succeeded or nobody's box matched anything (else unmatched rows are re-read nightly);
// stamp nothing when every attempted send failed, so tomorrow retries.
export function shouldStampDigest(attempted: number, succeeded: number): boolean {
  return attempted === 0 || succeeded > 0;
}
