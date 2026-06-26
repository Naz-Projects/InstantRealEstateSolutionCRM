import { describe, it, expect } from "vitest";
import {
  parseConditionResponse,
  buildConditionPrompt,
  CONDITION_SYSTEM_PROMPT,
  buildStreetViewImageUrl,
  buildStreetViewMetadataUrl,
  classifyStreetViewMetadata,
  CONDITION_MODEL,
  CONDITION_FLAGS,
} from "../src/scraper/conditionScore";

describe("parseConditionResponse", () => {
  it("parses clean JSON", () => {
    const r = parseConditionResponse(
      '{"score": 72, "flags": ["overgrown_vegetation","junk_debris"], "reason": "tall grass and debris"}',
    );
    expect(r.score).toBe(72);
    expect(r.flags).toEqual(["overgrown_vegetation", "junk_debris"]);
    expect(r.reason).toBe("tall grass and debris");
  });
  it("strips ```json fences", () => {
    const r = parseConditionResponse('```json\n{"score": 10, "flags": [], "reason": "tidy"}\n```');
    expect(r.score).toBe(10);
    expect(r.flags).toEqual([]);
  });
  it("recovers JSON from surrounding prose", () => {
    const r = parseConditionResponse(
      'Assessment: {"score": 55, "flags": ["distressed_exterior"], "reason": "worn siding"} done',
    );
    expect(r.score).toBe(55);
    expect(r.flags).toEqual(["distressed_exterior"]);
  });
  it("clamps out-of-range scores", () => {
    expect(parseConditionResponse('{"score": 150, "flags": [], "reason": ""}').score).toBe(100);
    expect(parseConditionResponse('{"score": -5, "flags": [], "reason": ""}').score).toBe(0);
  });
  it("rounds non-integer scores", () => {
    expect(parseConditionResponse('{"score": 63.7, "flags": [], "reason": ""}').score).toBe(64);
  });
  it("drops unknown flags and dedupes", () => {
    const r = parseConditionResponse(
      '{"score": 40, "flags": ["junk_debris","made_up","junk_debris"], "reason": "x"}',
    );
    expect(r.flags).toEqual(["junk_debris"]);
  });
  it("defaults missing reason to empty string", () => {
    expect(parseConditionResponse('{"score": 5, "flags": []}').reason).toBe("");
  });
  it("treats a non-numeric score as 0", () => {
    expect(parseConditionResponse('{"score": "n/a", "flags": [], "reason": "x"}').score).toBe(0);
  });
  it("throws when there is no JSON object", () => {
    expect(() => parseConditionResponse("the model refused")).toThrow();
  });
});

describe("prompts", () => {
  it("includes rubric anchors and the JSON contract", () => {
    const p = buildConditionPrompt();
    expect(p).toContain("0-20");
    expect(p).toContain("76-100");
    expect(p).toContain('"score"');
    expect(p).toContain('"flags"');
  });
  it("lists every known flag", () => {
    const p = buildConditionPrompt();
    for (const f of CONDITION_FLAGS) expect(p).toContain(f);
  });
  it("has a non-trivial system prompt", () => {
    expect(CONDITION_SYSTEM_PROMPT.length).toBeGreaterThan(20);
  });
});

describe("street view urls", () => {
  it("builds an image url with encoded address + key + outdoor source", () => {
    const u = buildStreetViewImageUrl("123 Main St, Newark, DE 19711", "KEY123");
    expect(u).toContain("https://maps.googleapis.com/maps/api/streetview?");
    expect(u).toContain("location=123+Main+St%2C+Newark%2C+DE+19711");
    expect(u).toContain("source=outdoor");
    expect(u).toContain("key=KEY123");
  });
  it("builds a metadata (coverage) url", () => {
    const u = buildStreetViewMetadataUrl("123 Main St", "KEY123");
    expect(u).toContain("/maps/api/streetview/metadata?");
    expect(u).toContain("key=KEY123");
  });
});

describe("model config", () => {
  it("defaults to gemini 2.5 flash when CONDITION_LLM_MODEL is unset", () => {
    expect(CONDITION_MODEL).toBe("google/gemini-2.5-flash");
  });
});

describe("classifyStreetViewMetadata", () => {
  it("treats OK as coverage", () => {
    expect(classifyStreetViewMetadata({ status: "OK" })).toEqual({ kind: "ok" });
  });
  it("treats ZERO_RESULTS as genuinely no imagery", () => {
    expect(classifyStreetViewMetadata({ status: "ZERO_RESULTS" })).toEqual({ kind: "no_imagery" });
  });
  it("treats NOT_FOUND as genuinely no imagery", () => {
    expect(classifyStreetViewMetadata({ status: "NOT_FOUND" })).toEqual({ kind: "no_imagery" });
  });
  it("surfaces REQUEST_DENIED as a hard error with the api message", () => {
    const r = classifyStreetViewMetadata({
      status: "REQUEST_DENIED",
      error_message: "This API is not activated on your API project.",
    });
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("REQUEST_DENIED");
      expect(r.message).toContain("not activated");
    }
  });
  it("surfaces OVER_QUERY_LIMIT as a hard error", () => {
    const r = classifyStreetViewMetadata({ status: "OVER_QUERY_LIMIT" });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("OVER_QUERY_LIMIT");
  });
  it("surfaces a missing status as an unknown error", () => {
    const r = classifyStreetViewMetadata({});
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unknown");
  });
});
