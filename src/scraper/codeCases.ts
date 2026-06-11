// NCC code-enforcement cases (CustomMaps/CodeEnforcement_CodeCases/MapServer/0) —
// pure URL building + feature parsing for the "code-violation" signal stream.
// Free, dated (APDTTM, epoch-ms in JSON), PRCLID-keyed, ~2.8k rows. Mirrors
// arcgisParcels.ts: explicit field list (NEVER outFields=*), keyset paging with an
// explicit orderBy, TIMESTAMP literal for the dated watermark (epoch-ms where 400s).

import type { SignalEventInput } from "./signals";

export const CODE_CASES_QUERY =
  "https://gis.nccde.org/agsserver/rest/services/CustomMaps/CodeEnforcement_CodeCases/MapServer/0/query";

export const CODE_CASE_FIELDS = [
  "PRCLID", "ADDR", "APNO", "APDTTM", "STAT", "APTYPE", "APDESC", "YEARSOPEN", "INSPECTIONS",
].join(",");

const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();

/** Dated + keyset query URL. `sinceIso` = "YYYY-MM-DD HH:MM:SS" watermark (overlap upstream). */
export function buildCodeCasesUrl({
  sinceIso,
  afterApno,
  pageSize,
}: { sinceIso?: string; afterApno?: string; pageSize: number }): string {
  const clauses: string[] = [];
  if (sinceIso) clauses.push(`APDTTM > TIMESTAMP '${sinceIso}'`);
  if (afterApno) clauses.push(`APNO > '${afterApno}'`);
  const where = clauses.length ? clauses.join(" AND ") : "1=1";
  return (
    `${CODE_CASES_QUERY}?where=${encodeURIComponent(where)}` +
    `&outFields=${encodeURIComponent(CODE_CASE_FIELDS)}&returnGeometry=false` +
    `&orderByFields=APNO&resultRecordCount=${pageSize}&f=json`
  );
}

/** ms epoch → the body of an ArcGIS TIMESTAMP literal, "YYYY-MM-DD HH:MM:SS" (UTC). */
export function toArcgisTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** Parse one ArcGIS feature's attributes into a signal event. Pure, null-safe. */
export function parseCodeCaseFeature(attrs: Record<string, unknown>): SignalEventInput {
  const prclid = str(attrs.PRCLID);
  const apno = str(attrs.APNO);
  const observedDate = typeof attrs.APDTTM === "number" ? attrs.APDTTM : 0;
  return {
    prclid,
    category: "physical",
    type: "code-violation",
    source: "ncc-arcgis-codecases",
    externalKey: apno ? `cc:${apno}` : `cc:${prclid}:${observedDate}`,
    observedDate,
    status: str(attrs.STAT),
    payload: {
      addr: str(attrs.ADDR),
      apno,
      aptype: str(attrs.APTYPE),
      apdesc: str(attrs.APDESC),
      yearsOpen: str(attrs.YEARSOPEN),
      inspections: typeof attrs.INSPECTIONS === "number" ? attrs.INSPECTIONS : 0,
    },
  };
}
