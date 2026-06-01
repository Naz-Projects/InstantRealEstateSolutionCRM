import { describe, it, expect } from "vitest";
import { parseParcelMarkdown } from "../src/scraper/parcel.js";

const SAMPLE = `
# Parcel Details

| Property Address: | 100 MAIN ST<br>WILMINGTON, DE 19801 |
| Owner: | DOE JANE |
| Owner Address: | 100 MAIN ST<br>WILMINGTON, DE 19801 |
| Property Class: | Residential |
| Total: | $200,000 |
| County Balance Due: | $1,234.56 |
| School Balance Due: | $2,000.00 |
| Balance Due: | $0.00 |
`;

describe("parseParcelMarkdown", () => {
  const f = parseParcelMarkdown(SAMPLE);

  it("splits property address from city/state/zip", () => {
    expect(f.propertyAddress).toBe("100 MAIN ST");
    expect(f.cityStateZip).toBe("WILMINGTON, DE 19801");
  });

  it("extracts owner and assessment", () => {
    expect(f.ownerName).toBe("DOE JANE");
    expect(f.assessmentTotal).toBe("$200,000");
  });

  it("maps the three balance-due fields", () => {
    expect(f.countyBalanceDue).toBe("$1,234.56");
    expect(f.schoolBalanceDue).toBe("$2,000.00");
    expect(f.sewerBalanceDue).toBe("$0.00");
  });

  it("ignores non-field rows", () => {
    expect(Object.keys(f)).not.toContain("undefined");
  });
});
