import { describe, it, expect } from "vitest";
import { esc, dealLink, digestCells, buildDigest, type DigestRow } from "../src/scraper/monitorDigest";
import { MINUS } from "../src/scraper/monitorPresent";

const OPTS = { baseUrl: "https://crm.example.com/", moreOnBoard: 7, date: "Oct 3" };
const FLIP: DigestRow = {
  _id: "abc123", address: "319 E 13th St, Wilmington, DE 19801", bestExit: "FLIP", dealScore: 90,
  listPrice: 99900, flipMao: 105271, roomVsList: 5371, photoUrls: ["https://photos.zillowstatic.com/a.jpg"],
  aiReason: "Deep below-market fixer with a halted renovation. More detail here.",
  redFlags: ["sparse_photos", "zipTier: city-high-risk", "Stop-work order"],
  exitTriage: "WHOLETAIL",
  url: "https://www.zillow.com/homedetails/319-E-13th-St/123_zpid/",
};
const RENTAL: DigestRow = {
  _id: "def456", address: "1529 W 4th St, Wilmington, DE 19805", bestExit: "RENTAL", dealScore: 40,
  listPrice: 74900, cashFlow: 477, dscr: 1.314, exitTriage: "FLIP",
};

describe("esc / dealLink", () => {
  it("escapes html-significant characters including quotes", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
  it("deep-links to the sheet and tolerates a trailing slash", () => {
    expect(dealLink("https://crm.example.com/", "abc123")).toBe("https://crm.example.com/monitor?id=abc123");
    expect(dealLink("https://crm.example.com", "a b")).toBe("https://crm.example.com/monitor?id=a%20b");
  });
});

describe("digestCells", () => {
  it("FLIP -> List / Max offer / Gap", () => {
    expect(digestCells(FLIP)).toEqual([
      { label: "List", value: "$99,900", tone: "neutral" },
      { label: "Max offer", value: "$105,271", tone: "neutral" },
      { label: "Gap", value: "+$5,371", tone: "pos" },
    ]);
  });
  it("RENTAL -> List / Cash flow / DSCR", () => {
    expect(digestCells(RENTAL).map((c) => c.value)).toEqual(["$74,900", "+$477/mo", "1.31"]);
  });
  it("negative gap is toned negative with a true minus", () => {
    expect(digestCells({ ...FLIP, roomVsList: -2000 })[2]).toEqual({ label: "Gap", value: `${MINUS}$2,000`, tone: "neg" });
  });
  it("non-finite numbers read as a dash, never NaN", () => {
    expect(digestCells({ ...FLIP, roomVsList: NaN })[2].value).toBe("—");
    expect(digestCells({ ...RENTAL, cashFlow: NaN, dscr: NaN }).map((c) => c.value)).toEqual(["$74,900", "—", "—"]);
  });
});

describe("buildDigest", () => {
  const d = buildDigest([FLIP, RENTAL], OPTS);

  it("subject mirrors the count", () => {
    expect(d.subject).toBe("IRES Monitor: 2 worth a look");
    expect(d.html).toContain("2 worth a look");
    expect(buildDigest([FLIP], OPTS).subject).toBe("IRES Monitor: 1 worth a look");
  });
  it("declares UTF-8 and a mobile viewport (the em dash and ellipsis must not turn into mojibake)", () => {
    expect(d.html).toMatch(/<head><meta charset="utf-8">/);
    expect(d.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });
  it("Zillow is the primary CTA; the CRM deep link stays as a secondary link", () => {
    expect(d.html.match(/>View on Zillow</g)).toHaveLength(1); // FLIP has a url
    expect(d.html).toContain('href="https://www.zillow.com/homedetails/319-E-13th-St/123_zpid/"');
    expect(d.html).toContain(">Open in CRM<");
    expect(d.html).toContain('href="https://crm.example.com/monitor?id=abc123"');
    expect(d.html.indexOf(">View on Zillow<")).toBeLessThan(d.html.indexOf(">Open in CRM<"));
    expect(d.text).toContain("Zillow: https://www.zillow.com/homedetails/319-E-13th-St/123_zpid/");
    expect(d.text).toContain("Review: https://crm.example.com/monitor?id=abc123");
  });
  it("no Zillow url -> the CRM Review deal button is primary", () => {
    expect(d.html.match(/>Review deal</g)).toHaveLength(1); // RENTAL has no url
    expect(d.html.match(/>Open in CRM</g)).toHaveLength(1);
    expect(d.html).toContain('href="https://crm.example.com/monitor?id=def456"');
    expect(d.text).not.toContain("Zillow: undefined");
  });
  it("small 96px side thumbnail, not a hero", () => {
    expect(d.html).toContain('width="96" height="72"');
    expect(d.html).not.toContain('width="560"');
  });
  it("one plain reason line (first sentence)", () => {
    expect(d.html).toContain("Deep below-market fixer with a halted renovation.");
    expect(d.html).not.toContain("More detail here");
  });
  it("at most one humanized flag; no raw slugs", () => {
    expect(d.html).toContain("Few listing photos");
    expect(d.html).not.toContain("Wilmington city ZIP");
    expect(d.html).not.toContain("sparse_photos");
    expect(d.html).not.toContain("zipTier");
  });
  it("analyst line only when it disagrees and score >= 50", () => {
    expect(d.html).toContain("Analyst leans Wholetail"); // FLIP card, score 90
    expect(d.html).not.toContain("Analyst leans Flip"); // RENTAL card, score 40
  });
  it("AA palette: darkened teal, no old teal, no white-on-amber", () => {
    expect(d.html).toContain("#1F7A66");
    expect(d.html).not.toMatch(/#2D9C84/i);
    expect(d.html).not.toMatch(/#B7791F/i);
  });
  it("footer counts the rest of the board", () => {
    expect(d.html).toContain("7 more on the board");
    expect(d.text).toContain("7 more on the board");
    expect(buildDigest([FLIP], { ...OPTS, moreOnBoard: 0 }).html).toContain("Open the board");
  });
  it("never claims a spread vs ARV", () => {
    expect(d.html).not.toMatch(/vs ARV/i);
  });
});

describe("buildDigest XSS + odd data", () => {
  it("escapes a hostile address and reason", () => {
    const evil: DigestRow = { ...FLIP, address: `<script>alert(1)</script>`, aiReason: `<img src=x onerror=alert(1)>.` };
    const { html } = buildDigest([evil], OPTS);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
  });
  it("drops a javascript: photo and escapes a quote-bearing photo URL", () => {
    expect(buildDigest([{ ...FLIP, photoUrls: ["javascript:alert(1)"] }], OPTS).html).not.toContain("<img");
    const q = buildDigest([{ ...FLIP, photoUrls: [`https://x.com/a.jpg" onerror="alert(1)`] }], OPTS).html;
    expect(q).not.toContain(`" onerror="`);
    expect(q).toContain("&quot; onerror=&quot;");
  });
  it("drops a javascript: Zillow url (CRM button primary) and escapes a quote-bearing one", () => {
    const js = buildDigest([{ ...FLIP, url: "javascript:alert(1)" }], OPTS);
    expect(js.html).not.toContain("javascript:");
    expect(js.html).not.toContain("View on Zillow");
    expect(js.html).toContain(">Review deal<");
    expect(js.text).not.toContain("Zillow:");
    const q = buildDigest([{ ...FLIP, url: `https://www.zillow.com/a" onclick="alert(1)` }], OPTS).html;
    expect(q).not.toContain(`" onclick="`);
    expect(q).toContain("&quot; onclick=&quot;");
  });
  it("a card with no photo, no reason and no flags still renders its numbers and CTA", () => {
    const bare: DigestRow = { _id: "z", address: "1 Main St", bestExit: "FLIP", listPrice: 100000, flipMao: 90000, roomVsList: -10000 };
    const { html } = buildDigest([bare], OPTS);
    expect(html).not.toContain("<img");
    expect(html).toContain("Max offer");
    expect(html).toContain(">Review deal<");
  });
});

describe("Phase 4 alert tag", () => {
  const cut = { ...FLIP, alertTag: "PRICE CUT $15,000" };
  it("renders the tag on the card (html + text), escaped", () => {
    const d = buildDigest([cut, RENTAL], OPTS);
    expect(d.html).toContain(">PRICE CUT $15,000<");
    expect(d.text).toContain("PRICE CUT $15,000");
    expect(buildDigest([{ ...FLIP, alertTag: `<b>x</b>` }], OPTS).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("subject counts re-alerts; untagged digests keep Phase 3's exact subject", () => {
    expect(buildDigest([cut, RENTAL], OPTS).subject).toBe("IRES Monitor: 2 worth a look · 1 price cut / back on market");
    expect(buildDigest([FLIP, RENTAL], OPTS).subject).toBe("IRES Monitor: 2 worth a look");
    expect(buildDigest([{ ...FLIP, alertTag: null }], OPTS).subject).toBe("IRES Monitor: 1 worth a look");
  });
});

describe("2026-10-20 lanes: Below market + Distress sections", () => {
  const WHOLE: DigestRow = {
    _id: "w1", address: "21 Poe Way, Newark, DE 19702", bestExit: "WHOLESALE", dealScore: 20,
    listPrice: 170000, flipMao: 128564, spread: 26400, spreadPct: 13.4, zestimate: 196400,
  };
  const DIST: DigestRow = {
    _id: "d1", address: "724 E 22nd St, Wilmington, DE 19802", bestExit: "DISTRESS", dealScore: 10,
    listPrice: 120000, flipMao: 36337, spread: 7498, spreadPct: 5.9,
    riskFlags: ["tax rate estimated 1.6% (VERIFY)", "Distress signal: investor special"],
  };

  it("WHOLESALE leads with the offer ceiling, then list, then how far below value", () => {
    expect(digestCells(WHOLE)).toEqual([
      { label: "Offer ceiling", value: "$128,564", tone: "neutral" },
      { label: "List", value: "$170,000", tone: "neutral" },
      { label: "Below Zestimate", value: "13.4%", tone: "pos" },
    ]);
    expect(digestCells({ ...WHOLE, zestimate: null })[2].label).toBe("Below as-is value");
  });
  it("no offer ceiling (renovated / rehab unknown) reads as a dash", () => {
    expect(digestCells({ ...WHOLE, flipMao: null })[0]).toEqual({ label: "Offer ceiling", value: "—", tone: "neutral" });
  });
  it("DISTRESS leads with the offer ceiling and names the signal", () => {
    expect(digestCells(DIST).map((c) => [c.label, c.value])).toEqual([["Offer ceiling", "$36,337"], ["List", "$120,000"], ["Signal", "Investor special"]]);
    expect(digestCells({ ...DIST, riskFlags: [] })[2].value).toBe("—");
  });
  it("sections in lane order with headings (html + text); the count covers every lane", () => {
    const d = buildDigest([FLIP, WHOLE, DIST], OPTS);
    expect(d.subject).toBe("IRES Monitor: 3 worth a look");
    const order = [d.html.indexOf(">Flip and rental<"), d.html.indexOf("319 E 13th St"), d.html.indexOf(">Below market<"),
      d.html.indexOf("21 Poe Way"), d.html.indexOf(">Distress<"), d.html.indexOf("724 E 22nd St")];
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(d.text).toMatch(/FLIP AND RENTAL[\s\S]*319 E 13th St[\s\S]*BELOW MARKET[\s\S]*21 Poe Way[\s\S]*DISTRESS\n[\s\S]*724 E 22nd St/);
  });
  it("rows arriving out of lane order are still grouped by lane", () => {
    const d = buildDigest([DIST, WHOLE, FLIP], OPTS);
    expect(d.html.indexOf("319 E 13th St")).toBeLessThan(d.html.indexOf("21 Poe Way"));
    expect(d.html.indexOf("21 Poe Way")).toBeLessThan(d.html.indexOf("724 E 22nd St"));
  });
  it("a single-lane digest has no section headings (Phase 3 look unchanged)", () => {
    expect(buildDigest([FLIP, RENTAL], OPTS).html).not.toContain(">Flip and rental<");
    expect(buildDigest([WHOLE], OPTS).html).not.toContain(">Below market<");
  });
  it("lane pills label the card's own exit, never a FLIP fallback", () => {
    const d = buildDigest([DIST], OPTS);
    expect(d.html).toContain(">DISTRESS<");
    expect(d.html).not.toContain(">FLIP<");
    expect(d.text).toContain("DISTRESS 10 · 724 E 22nd St");
  });
});
