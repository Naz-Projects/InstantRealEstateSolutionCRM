import { describe, it, expect } from "vitest";
import {
  FRED_SERIES,
  parseFredJson,
  parseFredCsv,
  pickLatest,
  isFresh,
} from "../src/scraper/fred";

describe("FRED_SERIES catalog", () => {
  it("includes rates, all DE counties' active listings, and DE days-on-market", () => {
    const ids = FRED_SERIES.map((s) => s.seriesId);
    expect(ids).toContain("MORTGAGE30US");
    expect(ids).toContain("FEDFUNDS");
    expect(ids).toContain("ACTLISCOU10003"); // New Castle
    expect(ids).toContain("ACTLISCOU10001"); // Kent
    expect(ids).toContain("ACTLISCOU10005"); // Sussex
    expect(ids).toContain("ACTLISCOUDE"); // Delaware total
    expect(ids).toContain("MEDDAYONMARDE");
  });

  it("every series has a non-empty label/region/source and a valid unit+group", () => {
    for (const s of FRED_SERIES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.region.length).toBeGreaterThan(0);
      expect(s.source.toLowerCase()).toContain("fred");
      expect(["percent", "usd", "count", "days"]).toContain(s.unit);
      expect(["rates", "inventory", "temperature"]).toContain(s.group);
    }
  });

  it("the inventory group is exactly the three DE counties + the state total", () => {
    const regions = FRED_SERIES.filter((s) => s.group === "inventory")
      .map((s) => s.region)
      .sort();
    expect(regions).toEqual(["Delaware", "Kent", "New Castle", "Sussex"]);
  });
});

describe("parseFredJson", () => {
  const body = {
    observations: [
      // FRED returns newest-first when sort_order=desc; parser must normalize.
      { date: "2026-01-01", value: "6.53" },
      { date: "2025-12-01", value: "6.40" },
      { date: "2025-11-01", value: "." }, // missing marker — dropped
    ],
  };

  it("returns observations oldest→newest with numeric values, dropping '.'", () => {
    expect(parseFredJson(body)).toEqual([
      { date: "2025-12-01", value: 6.4 },
      { date: "2026-01-01", value: 6.53 },
    ]);
  });

  it("returns [] for malformed input", () => {
    expect(parseFredJson(null)).toEqual([]);
    expect(parseFredJson({})).toEqual([]);
    expect(parseFredJson({ observations: "nope" })).toEqual([]);
  });
});

describe("parseFredCsv", () => {
  it("parses the no-key fredgraph.csv shape oldest→newest, dropping '.'", () => {
    const csv = "DATE,ACTLISCOU10003\n2025-11-01,.\n2025-12-01,1200\n2026-01-01,1255\n";
    expect(parseFredCsv(csv)).toEqual([
      { date: "2025-12-01", value: 1200 },
      { date: "2026-01-01", value: 1255 },
    ]);
  });

  it("returns [] for empty / header-only csv", () => {
    expect(parseFredCsv("")).toEqual([]);
    expect(parseFredCsv("DATE,X\n")).toEqual([]);
  });
});

describe("pickLatest", () => {
  // 25 monthly observations Jan 2024 .. Jan 2026, values 1000..1024.
  const monthly = Array.from({ length: 25 }, (_, i) => {
    const monthIndex = i; // 0-based from 2024-01
    const year = 2024 + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return { date: `${year}-${String(month).padStart(2, "0")}-01`, value: 1000 + i };
  });

  it("selects latest, prior, and the ~year-ago value for monthly data", () => {
    const snap = pickLatest(monthly);
    expect(snap).not.toBeNull();
    expect(snap?.latestDate).toBe("2026-01-01");
    expect(snap?.latestValue).toBe(1024);
    expect(snap?.priorValue).toBe(1023); // Dec 2025
    expect(snap?.yearAgoValue).toBe(1012); // Jan 2025
  });

  it("caps history at 24 points, ordered oldest→newest ending at the latest", () => {
    const snap = pickLatest(monthly);
    expect(snap?.history.length).toBe(24);
    expect(snap?.history[snap.history.length - 1]).toEqual({
      date: "2026-01-01",
      value: 1024,
    });
  });

  it("yearAgoValue is null when the window is under a year", () => {
    const snap = pickLatest(monthly.slice(-6));
    expect(snap?.priorValue).not.toBeNull();
    expect(snap?.yearAgoValue).toBeNull();
  });

  it("returns null for no observations", () => {
    expect(pickLatest([])).toBeNull();
  });
});

describe("isFresh", () => {
  const now = new Date("2026-06-04T12:00:00");
  it("is true within the window", () => {
    expect(isFresh("2026-04-01", 120, now)).toBe(true);
  });
  it("is false outside the window", () => {
    expect(isFresh("2024-11-01", 120, now)).toBe(false);
  });
});
