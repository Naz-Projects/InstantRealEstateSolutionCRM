import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLAINTIFF_STEMS,
  buildPartySearchUrl,
  parsePartySearchHtml,
  isNccForeclosure,
  parseCourtDate,
  extractDefendants,
  normalizeOwnerName,
  matchDefendantToOwners,
  selectAutoAttachMatch,
} from "../src/scraper/courtConnect";

// Live party-search page captured 2026-06-11 (last_name=bank, 12-MAY..11-JUN-2026).
const html = readFileSync(join(__dirname, "fixtures", "courtconnect-search.html"), "utf-8");

describe("PLAINTIFF_STEMS", () => {
  it("is a non-empty list of lowercase lender stems", () => {
    expect(PLAINTIFF_STEMS.length).toBeGreaterThanOrEqual(20);
    for (const s of PLAINTIFF_STEMS) expect(s).toBe(s.toLowerCase());
  });
});

describe("buildPartySearchUrl", () => {
  it("builds the documented GET with partial match, date range and page", () => {
    const url = buildPartySearchUrl({
      stem: "wilmington savings",
      beginDate: "12-MAY-2026",
      endDate: "11-JUN-2026",
      pageNo: 2,
    });
    expect(url).toContain("ck_public_qry_cpty.cp_personcase_srch_details?backto=P");
    expect(url).toContain("partial_ind=checked");
    expect(url).toContain("last_name=wilmington%20savings");
    expect(url).toContain("begin_date=12-MAY-2026");
    expect(url).toContain("end_date=11-JUN-2026");
    expect(url).toContain("PageNo=2");
    // the case_type URL filter silently returns zero rows — must stay empty
    expect(url).toContain("case_type=&");
  });
});

describe("parsePartySearchHtml", () => {
  const page = parsePartySearchHtml(html);

  it("extracts party rows with case id, caption, type, filing date, status", () => {
    const belfon = page.rows.find((r) => r.caseId === "N26L-06-005");
    expect(belfon).toBeDefined();
    expect(belfon!.partyName).toBe("BANK OF AMERICA, N.A.");
    expect(belfon!.caption).toBe("BANK OF AMERICA, N.A. V. BERTRAND BELFON, ET AL");
    expect(belfon!.partyType).toBe("PLAINTIFF");
    expect(belfon!.filingDate).toBe(Date.UTC(2026, 5, 2));
    expect(belfon!.caseStatus).toBe("NEW-NEW");
  });

  it("returns every result row in the table (including duplicate case rows)", () => {
    expect(page.rows.length).toBeGreaterThanOrEqual(10);
    const ives = page.rows.filter((r) => r.caseId === "N26L-05-058");
    expect(ives.length).toBe(3); // one row per party record — dedupe is the caller's job
  });

  it("detects the next-page link", () => {
    expect(page.hasNextPage).toBe(true);
    expect(parsePartySearchHtml("<html><body>no results</body></html>").hasNextPage).toBe(false);
  });
});

describe("isNccForeclosure", () => {
  it("accepts NCC L-docket cases and rejects everything else", () => {
    expect(isNccForeclosure("N26L-06-005")).toBe(true);
    expect(isNccForeclosure("N25L-12-101")).toBe(true);
    expect(isNccForeclosure("S26L-05-018")).toBe(false); // Sussex
    expect(isNccForeclosure("N26J-03612")).toBe(false); // judgment docket
    expect(isNccForeclosure("CPU4-26-001865")).toBe(false); // CCP civil
  });
});

describe("parseCourtDate", () => {
  it("parses DD-MON-YYYY to UTC ms", () => {
    expect(parseCourtDate("02-JUN-2026")).toBe(Date.UTC(2026, 5, 2));
    expect(parseCourtDate("28-MAY-2026")).toBe(Date.UTC(2026, 4, 28));
  });
  it("returns 0 on garbage", () => {
    expect(parseCourtDate("")).toBe(0);
    expect(parseCourtDate("JUNK")).toBe(0);
  });
});

describe("extractDefendants", () => {
  it("splits the caption on V./VS and strips ET AL", () => {
    expect(extractDefendants("BANK OF AMERICA, N.A. V. BERTRAND BELFON, ET AL")).toEqual([
      "BERTRAND BELFON",
    ]);
    expect(extractDefendants("BANK OF AMERICA NA VS PAUL L HERBERT JR")).toEqual([
      "PAUL L HERBERT JR",
    ]);
  });
  it("splits multiple defendants joined by AND", () => {
    expect(
      extractDefendants("WILMINGTON SAVINGS FUND SOCIETY VS JOHN DOE AND JANE DOE"),
    ).toEqual(["JOHN DOE", "JANE DOE"]);
  });
  it("returns [] when no versus separator exists", () => {
    expect(extractDefendants("IN RE SOMETHING")).toEqual([]);
  });
});

describe("normalizeOwnerName / matchDefendantToOwners", () => {
  it("normalizes punctuation, case and whitespace", () => {
    expect(normalizeOwnerName(" Belfon,  Bertrand. ")).toBe("BELFON BERTRAND");
  });

  it("matches surname-first spine owner names as exact (same token set)", () => {
    const matches = matchDefendantToOwners("BERTRAND BELFON", [
      { prclid: "1", ownerName: "BELFON BERTRAND" },
      { prclid: "2", ownerName: "SMITH JOHN" },
    ]);
    expect(matches).toEqual([{ prclid: "1", confidence: "exact" }]);
  });

  it("matches an owner with an extra middle initial as strong", () => {
    const matches = matchDefendantToOwners("PAUL HERBERT", [
      { prclid: "3", ownerName: "HERBERT PAUL L" },
    ]);
    expect(matches).toEqual([{ prclid: "3", confidence: "strong" }]);
  });

  it("treats surname + first-initial overlap as weak", () => {
    const matches = matchDefendantToOwners("DANIEL PATRICK IVES", [
      { prclid: "4", ownerName: "IVES D P" },
    ]);
    expect(matches).toEqual([{ prclid: "4", confidence: "weak" }]);
  });

  it("does NOT match on surname alone (conservative)", () => {
    expect(
      matchDefendantToOwners("DANIEL IVES", [{ prclid: "5", ownerName: "IVES MARGARET" }]),
    ).toEqual([]);
  });

  it("ignores corporate suffixes and single-token defendants", () => {
    expect(matchDefendantToOwners("LLC", [{ prclid: "6", ownerName: "LLC" }])).toEqual([]);
  });
});

describe("selectAutoAttachMatch", () => {
  it("auto-attaches ONLY a unique exact match", () => {
    expect(selectAutoAttachMatch([{ prclid: "1", confidence: "exact" }])).toBe("1");
  });
  it("returns null when two exact matches point to different parcels (ambiguous)", () => {
    expect(
      selectAutoAttachMatch([
        { prclid: "1", confidence: "exact" },
        { prclid: "2", confidence: "exact" },
      ]),
    ).toBeNull();
  });
  it("collapses duplicate exact matches on the SAME parcel to that one prclid", () => {
    // joint owners on one parcel — still unambiguous, safe to attach
    expect(
      selectAutoAttachMatch([
        { prclid: "9", confidence: "exact" },
        { prclid: "9", confidence: "exact" },
      ]),
    ).toBe("9");
  });
  it("never auto-attaches a strong-only match", () => {
    expect(selectAutoAttachMatch([{ prclid: "3", confidence: "strong" }])).toBeNull();
  });
  it("never auto-attaches a weak-only match (the wrong-owner footgun)", () => {
    expect(selectAutoAttachMatch([{ prclid: "4", confidence: "weak" }])).toBeNull();
  });
  it("returns null for no matches", () => {
    expect(selectAutoAttachMatch([])).toBeNull();
  });
});

describe("formatCourtDate", () => {
  it("formats ms as DD-MON-YYYY (UTC)", async () => {
    const { formatCourtDate } = await import("../src/scraper/courtConnect");
    expect(formatCourtDate(Date.UTC(2026, 5, 2))).toBe("02-JUN-2026");
    expect(formatCourtDate(Date.UTC(2026, 0, 15))).toBe("15-JAN-2026");
  });
});
