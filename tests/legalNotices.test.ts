import { describe, it, expect } from "vitest";
import {
  findLatestLegalPdfUrl,
  parseLegalListingsResponse,
} from "../src/scraper/legalNotices.js";

describe("findLatestLegalPdfUrl", () => {
  const MD = `
# Legal Notices

- [New Castle Weekly Notices 2026-05-25](https://www.newcastlede.gov/DocumentCenter/View/900/Weekly-2026-05-25)
- [New Castle Weekly Notices 2026-06-01](/DocumentCenter/View/950/Weekly-2026-06-01)
- [Some Other Document](https://www.newcastlede.gov/DocumentCenter/View/111/Other)
`;

  it("picks the latest weekly notice and absolutizes a relative URL", () => {
    const r = findLatestLegalPdfUrl(MD);
    expect(r).not.toBeNull();
    expect(r!.dateFound).toBe("2026-06-01");
    expect(r!.pdfUrl).toBe("https://www.newcastlede.gov/DocumentCenter/View/950/Weekly-2026-06-01");
  });

  it("returns null when no weekly notice link exists", () => {
    expect(findLatestLegalPdfUrl("[Other](https://x/DocumentCenter/View/1/o)")).toBeNull();
  });

  it("handles HTML anchors with nested tags", () => {
    const html =
      '<a href="https://www.newcastlede.gov/DocumentCenter/View/950/x"><span>New Castle Weekly Notices 2026-06-08</span></a>';
    const r = findLatestLegalPdfUrl(html);
    expect(r!.dateFound).toBe("2026-06-08");
  });
});

describe("parseLegalListingsResponse", () => {
  const obj = { title: "Estate of A", owner_name: "A", address: "1 ST", personal_representative: "B" };

  it("parses a ```json-fenced array", () => {
    const r = parseLegalListingsResponse("```json\n[" + JSON.stringify(obj) + "]\n```");
    expect(r).toHaveLength(1);
    expect(r[0].owner_name).toBe("A");
  });
  it("parses a plain array", () => {
    expect(parseLegalListingsResponse(JSON.stringify([obj, obj]))).toHaveLength(2);
  });
  it("wraps a single object as a one-element array", () => {
    const r = parseLegalListingsResponse(JSON.stringify(obj));
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("Estate of A");
  });
  it("ignores trailing prose after the array", () => {
    const r = parseLegalListingsResponse("[" + JSON.stringify(obj) + "]\n\nNote: that's all the listings.");
    expect(r).toHaveLength(1);
  });
  it("returns [] for total garbage (never throws)", () => {
    expect(parseLegalListingsResponse("I could not find any listings.")).toEqual([]);
  });
  it("returns [] for an empty string", () => {
    expect(parseLegalListingsResponse("")).toEqual([]);
  });
  it("returns [] for truncated / malformed JSON", () => {
    expect(parseLegalListingsResponse('[{"title":"x",')).toEqual([]);
  });
});
