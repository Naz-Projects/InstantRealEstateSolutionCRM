// Delaware CourtConnect party search — pure URL building, HTML parsing and
// defendant→owner name matching for the "pre-foreclosure" signal stream.
// Live-verified 2026-06-11 (memory/architecture-review-2026-06-11.md §2):
// plain GET, no captcha; NCC mortgage foreclosures are the L docket (case numbers
// ^N\d{2}L-) — the case_type=LM URL filter silently returns ZERO rows, so the
// docket filter happens client-side. Party name is a mandatory search field, so
// the sweep iterates lender PLAINTIFF_STEMS with partial match. ToS: internal
// use only, tiny volume, polite pacing (see the spec).

export const COURTCONNECT_PARTY_SEARCH =
  "https://courtconnect.courts.delaware.gov/cc/cconnect/ck_public_qry_cpty.cp_personcase_srch_details";

// Lender name stems for the weekly sweep (partial match ON). Editable config —
// coverage can be tuned by appending stems; case numbers dedupe across stems.
export const PLAINTIFF_STEMS = [
  "bank",
  "wilmington savings",
  "wilmington trust",
  "midfirst",
  "nationstar",
  "pennymac",
  "deutsche",
  "mellon",
  "federal national",
  "fannie",
  "freddie",
  "lakeview",
  "carrington",
  "freedom mortgage",
  "newrez",
  "us bank",
  "u.s. bank",
  "wells",
  "mtglq",
  "rocket",
  "loandepot",
  "mortgage",
  "savings fund",
  "hsbc",
  "citizens",
  "truist",
  "pnc",
  "santander",
  "specialized loan",
  "select portfolio",
  "shellpoint",
  "mr. cooper",
];

export interface CourtPartyRow {
  partyName: string;
  caseId: string;
  caption: string;
  partyType: string;
  filingDate: number; // UTC ms (0 when unparseable)
  caseStatus: string;
}

export interface PartySearchPage {
  rows: CourtPartyRow[];
  hasNextPage: boolean;
}

/** Party-search GET URL. Dates are DD-MON-YYYY. case_type stays EMPTY (LM filter is broken). */
export function buildPartySearchUrl({
  stem,
  beginDate,
  endDate,
  pageNo,
}: { stem: string; beginDate: string; endDate: string; pageNo: number }): string {
  return (
    `${COURTCONNECT_PARTY_SEARCH}?backto=P&soundex_ind=&partial_ind=checked` +
    `&last_name=${encodeURIComponent(stem)}&first_name=&middle_name=` +
    `&begin_date=${beginDate}&end_date=${endDate}&case_type=&id_code=&PageNo=${pageNo}`
  );
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** ms epoch → CourtConnect's DD-MON-YYYY (UTC). */
export function formatCourtDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${dd}-${MONTH_NAMES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** "02-JUN-2026" → UTC ms; 0 on anything unparseable. */
export function parseCourtDate(s: string): number {
  const m = s.trim().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  if (!m || MONTHS[m[2]] === undefined) return 0;
  return Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]));
}

/** NCC Superior Court mortgage-foreclosure docket: N<yy>L-… (Sussex S…L / judgments N…J excluded). */
export function isNccForeclosure(caseId: string): boolean {
  return /^N\d{2}L-/.test(caseId);
}

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parse a party-search result page. Result rows live in a bordered table; each row's
 * 3rd cell carries the case link (`case_id=…`) + caption. Rows without a case link
 * (header/search-params rows) are skipped. Duplicate rows per case are preserved —
 * dedupe by caseId is the caller's job.
 */
export function parsePartySearchHtml(html: string): PartySearchPage {
  const rows: CourtPartyRow[] = [];
  for (const tr of html.split(/<tr[^>]*>/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 7) continue;
    const caseMatch = cells[2].match(/case_id=([^&"']+)[^>]*>/i);
    if (!caseMatch) continue;
    const afterLink = cells[2].split(/<\/a>/i)[1] ?? "";
    rows.push({
      partyName: stripTags(cells[1]),
      caseId: caseMatch[1],
      caption: stripTags(afterLink),
      partyType: stripTags(cells[3]),
      filingDate: parseCourtDate(stripTags(cells[5])),
      caseStatus: stripTags(cells[6]),
    });
  }
  return { rows, hasNextPage: /Next-(&gt;|>)/.test(html) };
}

/** "PLAINTIFF V. DEFENDANT(S), ET AL" → ["DEFENDANT", …]. [] when no versus separator. */
export function extractDefendants(caption: string): string[] {
  const parts = caption.split(/\s+VS?\.?\s+/);
  if (parts.length < 2) return [];
  return parts
    .slice(1)
    .join(" ")
    .replace(/,?\s+ET\s+(AL|UX)\.?$/i, "")
    .split(/\s+AND\s+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Uppercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeOwnerName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);

const nameTokens = (s: string): string[] =>
  normalizeOwnerName(s)
    .split(" ")
    .filter((t) => t && !NAME_SUFFIXES.has(t));

export interface OwnerMatch {
  prclid: string;
  confidence: "exact" | "strong" | "weak";
}

/**
 * Match a caption defendant (FIRST [MIDDLE] LAST) against spine owner names
 * (CNTCTLAST is SURNAME-first: "GARDNER WILLIAM W"). Token-set comparison:
 * exact = same token set · strong = all defendant tokens present in the owner ·
 * weak = surname + first-initial only. Conservative: surname alone never matches,
 * single-token defendants never match.
 */
export function matchDefendantToOwners(
  defendant: string,
  candidates: Array<{ prclid: string; ownerName: string }>,
): OwnerMatch[] {
  const dTokens = nameTokens(defendant);
  if (dTokens.length < 2) return [];
  const dSet = new Set(dTokens);
  const surname = dTokens[dTokens.length - 1];
  const firstInitial = dTokens[0][0];

  const matches: OwnerMatch[] = [];
  for (const c of candidates) {
    const oTokens = nameTokens(c.ownerName);
    if (oTokens.length === 0) continue;
    const oSet = new Set(oTokens);
    if (dSet.size === oSet.size && dTokens.every((t) => oSet.has(t))) {
      matches.push({ prclid: c.prclid, confidence: "exact" });
    } else if (dTokens.every((t) => oSet.has(t))) {
      matches.push({ prclid: c.prclid, confidence: "strong" });
    } else if (
      oTokens[0] === surname &&
      oTokens.slice(1).some((t) => t.length === 1 && t === firstInitial)
    ) {
      matches.push({ prclid: c.prclid, confidence: "weak" });
    }
  }
  const rank = { exact: 0, strong: 1, weak: 2 } as const;
  return matches.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

/**
 * Decide whether a foreclosure case's defendant→owner matches are SAFE to
 * auto-attach as a scored pre-foreclosure lead (which gets mailed). Conservative:
 * returns a prclid ONLY when the matches resolve to a SINGLE parcel via an
 * 'exact' (full token-set) match. Returns null for anything ambiguous — multiple
 * distinct exact parcels, strong-only, weak-only (the surname + first-initial
 * footgun, e.g. "DAVID IVES" ⇒ "IVES MARGARET D"), or no matches — so the filing
 * is held for human review instead of mailing the wrong owner. Duplicate exact
 * matches on the same parcel (joint owners) collapse to that one prclid.
 */
export function selectAutoAttachMatch(matches: OwnerMatch[]): string | null {
  const exactPrclids = new Set(
    matches.filter((m) => m.confidence === "exact").map((m) => m.prclid),
  );
  return exactPrclids.size === 1 ? [...exactPrclids][0] : null;
}
