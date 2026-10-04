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
  it("one Review deal CTA per card, deep-linked", () => {
    expect(d.html.match(/>Review deal</g)).toHaveLength(2);
    expect(d.html).toContain('href="https://crm.example.com/monitor?id=abc123"');
    expect(d.text).toContain("Review: https://crm.example.com/monitor?id=abc123");
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
  it("a card with no photo, no reason and no flags still renders its numbers and CTA", () => {
    const bare: DigestRow = { _id: "z", address: "1 Main St", bestExit: "FLIP", listPrice: 100000, flipMao: 90000, roomVsList: -10000 };
    const { html } = buildDigest([bare], OPTS);
    expect(html).not.toContain("<img");
    expect(html).toContain("Max offer");
    expect(html).toContain(">Review deal<");
  });
});
