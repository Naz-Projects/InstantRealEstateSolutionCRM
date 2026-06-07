import { describe, it, expect } from "vitest";
import {
  parseParcelFeature,
  deriveAbsentee,
  parcelContentHash,
  buildParcelPageUrl,
  buildKeyPageUrl,
} from "../src/scraper/arcgisParcels";

// Real attribute row from the NCC ArcGIS Parcels layer (Phase 0 probe, 2026-06-06).
const realOutOfState = {
  PRCLID: "0600100003",
  ADDRESS: "1018     SMITH BRIDGE RD  ",
  STNO: "1018",
  STNAME: "SMITH BRIDGE",
  PROPCITY: "WILMINGTON",
  PROPSTATE: "DE",
  PROPZIP: "19803-    ",
  PROPCLASS: "RESIDENTIAL",
  LOTSZ: 5.22,
  CNTCTLAST: "GARDNER WILLIAM W",
  OWNADDR: "285 WILMINGTON-WEST CHESTER PIKE",
  OWNADDR2: null,
  OWNCITY: "CHADDS FORD",
  OWNSTATE: "PA",
  OWNZIP: "19317",
  OWNCOUNTRY: null,
};

// Owner-occupant: situs == owner mailing, but situs is messily spaced (the gotcha).
const ownerOccupant = {
  PRCLID: "1000000001",
  ADDRESS: "100     MAIN ST  ",
  PROPCITY: "NEWARK",
  PROPSTATE: "DE",
  PROPZIP: "19711",
  PROPCLASS: "RESIDENTIAL",
  LOTSZ: 0.25,
  CNTCTLAST: "DOE JOHN",
  OWNADDR: "100 MAIN ST",
  OWNCITY: "NEWARK",
  OWNSTATE: "DE",
  OWNZIP: "19711",
};

// In-state absentee: DE owner, different street number AND zip.
const inStateAbsentee = {
  PRCLID: "2000000002",
  ADDRESS: "200 OAK AVE",
  PROPCITY: "WILMINGTON",
  PROPSTATE: "DE",
  PROPZIP: "19805",
  CNTCTLAST: "SMITH JANE",
  OWNADDR: "55 ELM ST",
  OWNCITY: "DOVER",
  OWNSTATE: "DE",
  OWNZIP: "19901",
};

// Missing owner mailing entirely.
const missingOwner = {
  PRCLID: "3000000003",
  ADDRESS: "300 PINE RD",
  PROPCITY: "BEAR",
  PROPSTATE: "DE",
  PROPZIP: "19701",
  CNTCTLAST: "ESTATE OF X",
  OWNADDR: null,
  OWNSTATE: null,
  OWNZIP: null,
};

describe("parseParcelFeature", () => {
  it("maps the core spine fields and squashes situs whitespace", () => {
    const p = parseParcelFeature(realOutOfState);
    expect(p.prclid).toBe("0600100003");
    expect(p.situsStreet).toBe("1018 SMITH BRIDGE RD");
    expect(p.propCity).toBe("WILMINGTON");
    expect(p.propState).toBe("DE");
    expect(p.propZip).toBe("19803"); // trailing "-    " stripped to 5 digits
    expect(p.propClass).toBe("RESIDENTIAL");
    expect(p.lotSz).toBe(5.22);
    expect(p.ownerName).toBe("GARDNER WILLIAM W");
    expect(p.ownerState).toBe("PA");
    expect(p.ownerZip).toBe("19317");
  });
});

describe("deriveAbsentee", () => {
  it("flags an out-of-state owner", () => {
    expect(deriveAbsentee(parseParcelFeature(realOutOfState))).toEqual({
      absentee: true,
      reason: "out-of-state",
    });
  });

  it("does NOT flag an owner-occupant despite messy situs spacing", () => {
    expect(deriveAbsentee(parseParcelFeature(ownerOccupant))).toEqual({
      absentee: false,
      reason: "owner-occupant",
    });
  });

  it("flags an in-state owner at a different address", () => {
    expect(deriveAbsentee(parseParcelFeature(inStateAbsentee))).toEqual({
      absentee: true,
      reason: "in-state-absentee",
    });
  });

  it("does not flag when owner mailing is missing (conservative)", () => {
    expect(deriveAbsentee(parseParcelFeature(missingOwner))).toEqual({
      absentee: false,
      reason: "undetermined",
    });
  });
});

describe("parcelContentHash", () => {
  it("is stable for the same input", () => {
    const a = parcelContentHash(parseParcelFeature(realOutOfState));
    const b = parcelContentHash(parseParcelFeature(realOutOfState));
    expect(a).toBe(b);
  });

  it("changes when a meaningful field changes", () => {
    const base = parcelContentHash(parseParcelFeature(realOutOfState));
    const moved = parcelContentHash(
      parseParcelFeature({ ...realOutOfState, OWNADDR: "999 NEW ST" }),
    );
    expect(moved).not.toBe(base);
  });
});

describe("URL builders", () => {
  it("builds a full-field page URL with PRCLID ordering and paging", () => {
    const url = buildParcelPageUrl({ offset: 2000, pageSize: 1000 });
    expect(url).toContain("/BaseMaps/Base_Layers/MapServer/0/query");
    expect(url).toContain("outFields=*");
    expect(url).toContain("orderByFields=PRCLID");
    expect(url).toContain("resultOffset=2000");
    expect(url).toContain("resultRecordCount=1000");
    expect(url).toContain("returnGeometry=false");
  });

  it("builds a PRCLID-only key page URL (the CDC diff)", () => {
    const url = buildKeyPageUrl({ offset: 0, pageSize: 1000 });
    expect(url).toContain("outFields=PRCLID");
    expect(url).toContain("orderByFields=PRCLID");
    expect(url).not.toContain("outFields=*");
  });
});
