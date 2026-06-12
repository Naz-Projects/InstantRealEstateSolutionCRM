import { describe, it, expect } from "vitest";
import { buildMailCsv } from "../src/web/lib/mailCsv";

const lead = {
  ownerName: "BELFON BERTRAND",
  ownerAddr: "12 ELM ST",
  ownerAddr2: "",
  ownerCity: "NEWARK",
  ownerState: "DE",
  ownerZip: "19711",
  situsStreet: "34 OAK AVE",
  propCity: "WILMINGTON",
  propZip: "19805",
  score: 75,
  signalTypes: ["pre-foreclosure", "code-violation"],
  value: null,
  equity: null,
};

describe("buildMailCsv", () => {
  it("emits a header row plus one line per lead", () => {
    const csv = buildMailCsv([lead, { ...lead, ownerName: "SMITH JOHN" }]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "owner_name,mail_address,mail_address_2,mail_city,mail_state,mail_zip,property_address,property_city,property_zip,score,signals,value,equity",
    );
    expect(lines[1]).toContain("BELFON BERTRAND");
    expect(lines[1]).toContain("pre-foreclosure|code-violation");
  });

  it("quotes fields containing commas or quotes", () => {
    const csv = buildMailCsv([{ ...lead, ownerName: 'ACME "HOMES", LLC' }]);
    expect(csv).toContain('"ACME ""HOMES"", LLC"');
  });

  it("returns just the header for an empty set", () => {
    expect(buildMailCsv([]).trim().split("\n")).toHaveLength(1);
  });

  it("includes value and equity columns, blank when unknown", () => {
    const csv = buildMailCsv([
      {
        ownerName: "JONES JOHN", ownerAddr: "1 MAIN ST", ownerAddr2: "", ownerCity: "WILMINGTON",
        ownerState: "DE", ownerZip: "19801", situsStreet: "2 OAK AVE", propCity: "NEWARK",
        propZip: "19711", score: 80, signalTypes: ["pre-foreclosure"],
        value: 250000, equity: 245000,
      },
      {
        ownerName: "SMITH SUE", ownerAddr: "9 ELM ST", ownerAddr2: "", ownerCity: "DOVER",
        ownerState: "DE", ownerZip: "19901", situsStreet: "4 PINE RD", propCity: "BEAR",
        propZip: "19701", score: 40, signalTypes: ["code-violation"],
        value: null, equity: null,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("value,equity");
    expect(lines[1]).toContain("250000,245000");
    expect(lines[2].endsWith(",,")).toBe(true);
  });
});
