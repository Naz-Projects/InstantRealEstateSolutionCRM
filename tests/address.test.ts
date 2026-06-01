import { describe, it, expect } from "vitest";
import { cleanAddress, zillowAddress } from "../src/scraper/address.js";

describe("cleanAddress", () => {
  it("recovers a truncated DE zip and inserts DE state", () => {
    const out = cleanAddress("100 MAIN ST TOWNSEND1734");
    expect(out).toContain("TOWNSEND");
    expect(out).toContain("19734");
    expect(out).toMatch(/\bDE\b/);
  });

  it("inserts a missing space before a 5-digit zip", () => {
    const out = cleanAddress("100 MAIN ST WILMINGTON19801");
    expect(out).toContain("WILMINGTON");
    expect(out).toContain("19801");
    expect(out).toMatch(/\bDE\b/);
  });

  it("strips an AKA suffix but preserves city/state/zip", () => {
    const out = cleanAddress("100 MAIN ST AKA 100 MAIN STREET WILMINGTON DE 19801");
    expect(out).not.toContain("AKA");
    expect(out).toContain("19801");
  });

  it("marks a bare zip with the ZIP_ONLY fallback", () => {
    expect(cleanAddress("19703")).toBe("ZIP_ONLY:19703");
  });

  it("passes through N/A untouched", () => {
    expect(cleanAddress("N/A")).toBe("N/A");
  });
});

describe("zillowAddress", () => {
  it("returns a trimmed DE address", () => {
    expect(zillowAddress("100 MAIN ST WILMINGTON DE 19801")).toBe(
      "100 MAIN ST WILMINGTON DE 19801",
    );
  });

  it("strips UNIT/APT/AKA noise", () => {
    expect(zillowAddress("100 MAIN ST UNIT 5 WILMINGTON DE 19801")).toBe(
      "100 MAIN ST WILMINGTON DE 19801",
    );
  });

  it("rejects an address with no DE state", () => {
    expect(zillowAddress("100 MAIN ST WILMINGTON 19801")).toBeNull();
  });

  it("rejects error-coded addresses", () => {
    expect(zillowAddress("NO ADDRESS")).toBeNull();
    expect(zillowAddress("N/A")).toBeNull();
  });
});
