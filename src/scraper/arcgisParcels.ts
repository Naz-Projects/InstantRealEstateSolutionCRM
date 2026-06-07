// NCC ArcGIS parcel "spine" — pure, runtime-agnostic parsing + absentee derivation,
// reused by the Convex sync action (which does the network) and unit-tested here with
// captured ArcGIS feature rows. Layer = BaseMaps/Base_Layers/MapServer/0 (Phase 0 proved
// the count, paging, and that single-field paging REQUIRES orderByFields=PRCLID).
// See memory/source-matrix.md (spine proof) + distress-signals.md (absentee = top signal).

export const ARCGIS_PARCELS_QUERY =
  "https://gis.nccde.org/agsserver/rest/services/BaseMaps/Base_Layers/MapServer/0/query";

export interface Parcel {
  prclid: string;
  situsStreet: string; // cleaned ADDRESS line (whitespace squashed), e.g. "1018 SMITH BRIDGE RD"
  propCity: string;
  propState: string;
  propZip: string; // 5-digit
  propClass: string;
  lotSz: number | null;
  ownerName: string; // CNTCTLAST (NCC stores the full owner name string here)
  ownerAddr: string;
  ownerAddr2: string;
  ownerCity: string;
  ownerState: string;
  ownerZip: string; // 5-digit
  ownerCountry: string;
}

export interface AbsenteeResult {
  absentee: boolean;
  reason: "out-of-state" | "in-state-absentee" | "owner-occupant" | "undetermined";
}

/** Raw ArcGIS feature attributes (loose — fields may be null/missing). */
type Attrs = Record<string, unknown>;

const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();

/** First 5-digit run (handles trailing "-    " or zip+4). */
function zip5(v: unknown): string {
  const m = String(v ?? "").match(/\d{5}/);
  return m ? m[0] : "";
}

/** Leading house number (first run of digits at the start of a street line). */
function leadingNumber(v: string): string {
  const m = v.trim().match(/^(\d+)/);
  return m ? m[1] : "";
}

/** Parse one ArcGIS feature's attributes into a Parcel. Pure, null-safe. */
export function parseParcelFeature(attrs: Attrs): Parcel {
  const lot = attrs.LOTSZ;
  return {
    prclid: str(attrs.PRCLID),
    situsStreet: str(attrs.ADDRESS),
    propCity: str(attrs.PROPCITY),
    propState: str(attrs.PROPSTATE),
    propZip: zip5(attrs.PROPZIP),
    propClass: str(attrs.PROPCLASS),
    lotSz: typeof lot === "number" ? lot : lot ? Number(lot) || null : null,
    ownerName: str(attrs.CNTCTLAST),
    ownerAddr: str(attrs.OWNADDR),
    ownerAddr2: str(attrs.OWNADDR2),
    ownerCity: str(attrs.OWNCITY),
    ownerState: str(attrs.OWNSTATE),
    ownerZip: zip5(attrs.OWNZIP),
    ownerCountry: str(attrs.OWNCOUNTRY),
  };
}

/**
 * Absentee = owner does not live at the property. Out-of-state owner mailing is the
 * clean signal; for in-state we compare NORMALIZED house-number + ZIP (NOT raw strings
 * — situs addresses are messily spaced, so a string compare false-flags owner-occupants).
 * Conservative: when we can't tell, do NOT flag (keep the signal clean).
 */
export function deriveAbsentee(p: Parcel): AbsenteeResult {
  if (p.ownerState && p.ownerState !== "DE") {
    return { absentee: true, reason: "out-of-state" };
  }
  const sNo = leadingNumber(p.situsStreet);
  const oNo = leadingNumber(p.ownerAddr);
  const sZip = p.propZip;
  const oZip = p.ownerZip;

  const numbersDiffer = !!sNo && !!oNo && sNo !== oNo;
  const zipsDiffer = !!sZip && !!oZip && sZip !== oZip;
  if (numbersDiffer || zipsDiffer) {
    return { absentee: true, reason: "in-state-absentee" };
  }

  const numbersMatch = !!sNo && !!oNo && sNo === oNo;
  const zipsMatch = !!sZip && !!oZip && sZip === oZip;
  if (numbersMatch && zipsMatch) {
    return { absentee: false, reason: "owner-occupant" };
  }
  return { absentee: false, reason: "undetermined" };
}

/** Stable FNV-1a hash of the meaningful fields — change detection for the CDC sync. */
export function parcelContentHash(p: Parcel): string {
  const payload = [
    p.situsStreet, p.propCity, p.propState, p.propZip, p.propClass, p.lotSz ?? "",
    p.ownerName, p.ownerAddr, p.ownerAddr2, p.ownerCity, p.ownerState, p.ownerZip, p.ownerCountry,
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Full-field page URL for the seed (PRCLID-ordered paging). */
export function buildParcelPageUrl({ offset, pageSize }: { offset: number; pageSize: number }): string {
  return (
    `${ARCGIS_PARCELS_QUERY}?where=1%3D1&outFields=*&returnGeometry=false` +
    `&orderByFields=PRCLID&resultRecordCount=${pageSize}&resultOffset=${offset}&f=json`
  );
}

/** PRCLID-only key page URL for the CDC key-diff (cheap; orderByFields REQUIRED). */
export function buildKeyPageUrl({ offset, pageSize }: { offset: number; pageSize: number }): string {
  return (
    `${ARCGIS_PARCELS_QUERY}?where=1%3D1&outFields=PRCLID&returnGeometry=false` +
    `&orderByFields=PRCLID&resultRecordCount=${pageSize}&resultOffset=${offset}&f=json`
  );
}
