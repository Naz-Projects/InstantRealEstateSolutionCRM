import { describe, it, expect } from "vitest";
import { parseSheriffMarkdown } from "../src/scraper/sheriffParse.js";

const SAMPLE = `
Some preamble text from the PDF.

| TYPE | ATTORNEY | PLAINTIFF | SHERIFF SALE # | DEFENDANT | ADDRESS | PARCEL | STATUS | PRINCIPAL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MTG FORECLOSURE | John Atty | Bank NA | 2024-12345 | Jane Doe | 100 MAIN ST WILMINGTON19801 | 26-001.00-123 | ACTIVE | $150,000.00 |
| TAX SALE | Tax Atty | County | 2024-67890 | Bob Roe | 250 ELM AVE NEWARK19711 | 11-002.30-456 | ACTIVE | $9,800.00 |
`;

describe("parseSheriffMarkdown", () => {
  const { listings, saleMonth } = parseSheriffMarkdown(SAMPLE, new Date("2026-06-01T12:00:00Z"));

  it("parses both data rows and skips header/separator", () => {
    expect(listings).toHaveLength(2);
  });

  it("normalizes the sale type", () => {
    expect(listings[0].type).toBe("MTG");
    expect(listings[1].type).toBe("TAX");
  });

  it("cleans the address (space + DE state)", () => {
    expect(listings[0].address).toContain("WILMINGTON");
    expect(listings[0].address).toMatch(/\bDE\b/);
    expect(listings[0].address).toContain("19801");
  });

  it("keeps parcel, defendant, principal", () => {
    expect(listings[0].parcel).toBe("26-001.00-123");
    expect(listings[0].defendant).toBe("Jane Doe");
    expect(listings[0].principal).toBe("$150,000.00");
  });

  it("labels the sale month from the provided date", () => {
    expect(saleMonth).toBe("June 2026");
  });

  it("throws when markdown has no table", () => {
    expect(() => parseSheriffMarkdown("just some prose with no pipes at all here ok")).toThrow();
  });
});
