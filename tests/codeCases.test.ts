import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_CASES_QUERY,
  CODE_CASE_FIELDS,
  buildCodeCasesUrl,
  parseCodeCaseFeature,
} from "../src/scraper/codeCases";

// Live page captured 2026-06-11 from CustomMaps/CodeEnforcement_CodeCases/MapServer/0.
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "codecases-page.json"), "utf-8"),
);

describe("buildCodeCasesUrl", () => {
  it("requests an explicit field list, never outFields=*", () => {
    const url = buildCodeCasesUrl({ pageSize: 1000 });
    expect(url).toContain(`outFields=${encodeURIComponent(CODE_CASE_FIELDS)}`);
    expect(url).not.toContain("outFields=*");
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
    expect(url.startsWith(CODE_CASES_QUERY)).toBe(true);
  });

  it("keyset-pages ordered by APNO (single-field paging requires an explicit order)", () => {
    const url = buildCodeCasesUrl({ afterApno: "202603885", pageSize: 500 });
    expect(url).toContain("orderByFields=APNO");
    expect(url).toContain("resultRecordCount=500");
    expect(decodeURIComponent(url)).toContain("APNO > '202603885'");
  });

  it("uses the TIMESTAMP literal for the dated watermark (epoch-ms where 400s)", () => {
    const url = buildCodeCasesUrl({ sinceIso: "2026-05-01 00:00:00", pageSize: 1000 });
    const where = decodeURIComponent(url);
    expect(where).toContain("APDTTM > TIMESTAMP '2026-05-01 00:00:00'");
    expect(where).not.toMatch(/APDTTM > \d{10}/);
  });

  it("combines watermark and keyset cursor with AND", () => {
    const url = decodeURIComponent(
      buildCodeCasesUrl({ sinceIso: "2026-05-01 00:00:00", afterApno: "202600000", pageSize: 1000 }),
    );
    expect(url).toContain("APDTTM > TIMESTAMP '2026-05-01 00:00:00' AND APNO > '202600000'");
  });
});

describe("parseCodeCaseFeature", () => {
  const first = fixture.features[0].attributes;

  it("parses a real feature into a signal event shape", () => {
    const ev = parseCodeCaseFeature(first);
    expect(ev).toEqual({
      prclid: "0903430163",
      category: "physical",
      type: "code-violation",
      source: "ncc-arcgis-codecases",
      externalKey: "cc:202603920:0903430163",
      observedDate: 1781016182000,
      status: "O",
      payload: {
        addr: "156 WOODLAND RD NEWARK 19702",
        apno: "202603920",
        aptype: "IPMC",
        apdesc: "INTERNATIONAL PROPERTY MAINT",
        yearsOpen: "0",
        inspections: 1,
      },
    });
  });

  it("parses every feature in the captured page without throwing", () => {
    const events = fixture.features.map((f: any) => parseCodeCaseFeature(f.attributes));
    expect(events).toHaveLength(5);
    for (const ev of events) {
      expect(ev.prclid).toMatch(/^\d+$/);
      expect(ev.externalKey.startsWith("cc:")).toBe(true);
      expect(ev.observedDate).toBeGreaterThan(1_500_000_000_000);
    }
  });

  it("keys per case AND parcel (one case can span multiple parcels)", () => {
    const a = parseCodeCaseFeature({ ...first, PRCLID: "111" });
    const b = parseCodeCaseFeature({ ...first, PRCLID: "222" });
    expect(a.externalKey).not.toBe(b.externalKey);
  });

  it("falls back to prclid+date for the externalKey when APNO is missing", () => {
    const ev = parseCodeCaseFeature({ ...first, APNO: null });
    expect(ev.externalKey).toBe("cc:0903430163:1781016182000");
  });

  it("is null-safe on string fields and defaults a missing date to 0", () => {
    const ev = parseCodeCaseFeature({ PRCLID: "123", APNO: "1", APDTTM: null });
    expect(ev.status).toBe("");
    expect(ev.observedDate).toBe(0);
    expect(ev.payload.addr).toBe("");
  });
});

describe("toArcgisTimestamp", () => {
  it("formats ms as the TIMESTAMP literal body (UTC)", async () => {
    const { toArcgisTimestamp } = await import("../src/scraper/codeCases");
    expect(toArcgisTimestamp(Date.UTC(2026, 4, 1, 0, 0, 0))).toBe("2026-05-01 00:00:00");
    expect(toArcgisTimestamp(Date.UTC(2026, 11, 31, 23, 59, 9))).toBe("2026-12-31 23:59:09");
  });
});
