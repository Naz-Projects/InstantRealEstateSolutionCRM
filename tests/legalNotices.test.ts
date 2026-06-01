import { describe, it, expect } from "vitest";
import { findLatestLegalPdfUrl } from "../src/scraper/legalNotices.js";

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
