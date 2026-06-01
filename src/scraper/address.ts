// Address cleaning — ported verbatim in behavior from the n8n "Parse Table Data"
// and "Enrich with Zillow" code nodes. Handles the messy NCC sheriff-sale PDF
// addresses: truncated zips, missing spaces, AKA suffixes, missing DE state.

export const DE_CITIES = [
  "WILMINGTON", "NEWARK", "BEAR", "NEW CASTLE", "MIDDLETOWN", "DOVER",
  "CLAYMONT", "HOCKESSIN", "TOWNSEND", "SMYRNA", "CHRISTIANA", "ELSMERE",
  "PIKE CREEK", "GREENVILLE", "BROOKSIDE", "NEWPORT", "STANTON", "ODESSA",
  "DELAWARE CITY", "MILLSBORO",
];

// Subset used by the AKA-preservation and DE-state regexes in the original.
const CSZ_CITIES =
  "WILMINGTON|NEWARK|BEAR|NEW CASTLE|MIDDLETOWN|DOVER|CLAYMONT|HOCKESSIN|TOWNSEND|SMYRNA|CHRISTIANA|ELSMERE|NEWPORT|STANTON|ODESSA";

/** Clean a raw PDF address into a Zillow-searchable form, or a ZIP_ONLY marker. */
export function cleanAddress(raw: string): string {
  if (!raw || raw === "N/A") return raw;
  let addr = raw.replace(/\\\*/g, "").replace(/^\*/, "").replace(/\s+/g, " ").trim();

  // Fix truncated DE zips: PDF sometimes drops a digit from 19xxx zips.
  for (const city of DE_CITIES) {
    const trunc1 = new RegExp("(" + city + ")\\s*(1)(\\d{3})(?:\\b|$)", "gi");
    addr = addr.replace(trunc1, "$1 $29$3");
    const trunc9 = new RegExp("(" + city + ")\\s*(9\\d{3})(?:\\b|$)", "gi");
    addr = addr.replace(trunc9, "$1 1$2");
  }
  addr = addr.replace(/(\s)(1)(\d{3})\s*$/, "$1$29$3");

  // Insert space before a 5-digit zip if missing: 'WILMINGTON19801' -> 'WILMINGTON 19801'.
  addr = addr.replace(/(\D)(\d{5})(?:\b|$)/, "$1 $2");

  // Insert space before known cities if missing (handles digits too: 'B305WILMINGTON').
  for (const city of DE_CITIES) {
    const re = new RegExp("([A-Za-z0-9])(" + city + ")", "gi");
    addr = addr.replace(re, "$1 $2");
  }

  // Strip AKA suffixes but preserve city/state/zip from the end.
  if (/\s+AKA\s+/i.test(addr)) {
    const idx = addr.search(/\s+AKA\s+/i);
    const akaToken = addr.match(/\s+AKA\s+/i)![0];
    const beforeAka = addr.substring(0, idx);
    const afterAka = addr.substring(idx + akaToken.length);
    const cszMatch = afterAka.match(
      new RegExp("((?:" + CSZ_CITIES + ")\\s+(?:DE\\s+)?\\d{5}.*)$", "i"),
    );
    addr = beforeAka + (cszMatch ? " " + cszMatch[1] : "");
  }

  addr = addr.replace(/\s+/g, " ").trim();

  // Ensure DE state before zip.
  addr = addr.replace(
    new RegExp("((?:" + CSZ_CITIES + ")\\s+)(\\d{5})(-?)$", ""),
    "$1DE $2$3",
  );
  if (!/\bDE\b/.test(addr)) {
    addr = addr.replace(/(\s)(\d{5})(-?)\s*$/, " DE $2$3");
  }
  addr = addr.replace(/(\d{5})-\s*$/, "$1");

  if (/^\d{5}$/.test(addr.trim())) {
    addr = "ZIP_ONLY:" + addr.trim();
  }

  return addr;
}

/** Normalize an address for a Zillow search, or null if it isn't usable. */
export function zillowAddress(addr: string): string | null {
  if (
    !addr ||
    addr === "N/A" ||
    addr.startsWith("NO ADDRESS") ||
    addr.startsWith("SCRAPE FAILED")
  ) {
    return null;
  }
  let z = addr;
  z = z.replace(/\s+AKA\s+.*/i, "");
  z = z.replace(/\s+UNIT\s+\S+/i, "");
  z = z.replace(/\s+APT\s+\S+/i, "");
  if (!/\bDE\b/.test(z)) return null;
  return z.trim();
}
