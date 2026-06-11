import { describe, it, expect } from "vitest";
import { SCORE_CONFIG, computeLeadScore, equityBucket } from "../src/scraper/leadScore";

const NOW = Date.UTC(2026, 5, 11);
const DAY = 24 * 60 * 60 * 1000;

describe("computeLeadScore", () => {
  it("scores a fresh pre-foreclosure at its full type weight", () => {
    const score = computeLeadScore(
      [{ type: "pre-foreclosure", observedDate: NOW }],
      { absentee: false },
      NOW,
    );
    expect(score).toBe(SCORE_CONFIG.typeWeights["pre-foreclosure"]);
  });

  it("decays a signal to half its weight after one half-life", () => {
    const age = SCORE_CONFIG.recencyHalfLifeDays * DAY;
    const score = computeLeadScore(
      [{ type: "code-violation", observedDate: NOW - age }],
      { absentee: false },
      NOW,
    );
    expect(score).toBe(Math.round(SCORE_CONFIG.typeWeights["code-violation"] / 2));
  });

  it("uses the default weight for unknown signal types", () => {
    const score = computeLeadScore([{ type: "mystery", observedDate: NOW }], { absentee: false }, NOW);
    expect(score).toBe(SCORE_CONFIG.defaultWeight);
  });

  it("stacked signals add their weights plus a stack bonus", () => {
    const score = computeLeadScore(
      [
        { type: "pre-foreclosure", observedDate: NOW },
        { type: "code-violation", observedDate: NOW },
      ],
      { absentee: false },
      NOW,
    );
    expect(score).toBe(
      SCORE_CONFIG.typeWeights["pre-foreclosure"] +
        SCORE_CONFIG.typeWeights["code-violation"] +
        SCORE_CONFIG.stackBonus,
    );
  });

  it("multiplies the total for an absentee owner", () => {
    const base = computeLeadScore([{ type: "code-violation", observedDate: NOW }], { absentee: false }, NOW);
    const abs = computeLeadScore([{ type: "code-violation", observedDate: NOW }], { absentee: true }, NOW);
    expect(abs).toBe(Math.round(base * SCORE_CONFIG.absenteeMultiplier));
  });

  it("returns 0 for no signals", () => {
    expect(computeLeadScore([], { absentee: true }, NOW)).toBe(0);
  });
});

describe("equityBucket", () => {
  it("buckets by the configured ratio thresholds", () => {
    expect(equityBucket(0.6)).toBe("high");
    expect(equityBucket(0.5)).toBe("high");
    expect(equityBucket(0.3)).toBe("medium");
    expect(equityBucket(0.2)).toBe("medium");
    expect(equityBucket(0.1)).toBe("low");
    expect(equityBucket(-0.5)).toBe("low");
  });
  it("returns unknown for null ratio", () => {
    expect(equityBucket(null)).toBe("unknown");
  });
});

describe("computeLeadScore equity multiplier", () => {
  const sig = [{ type: "code-violation", observedDate: NOW }];
  const base = computeLeadScore(sig, { absentee: false }, NOW);

  it("multiplies by the bucket multiplier", () => {
    expect(computeLeadScore(sig, { absentee: false }, NOW, "high")).toBe(
      Math.round(base * SCORE_CONFIG.equityMultipliers.high),
    );
    expect(computeLeadScore(sig, { absentee: false }, NOW, "low")).toBe(
      Math.round(base * SCORE_CONFIG.equityMultipliers.low),
    );
  });
  it("unknown bucket and omitted arg leave the score unchanged", () => {
    expect(computeLeadScore(sig, { absentee: false }, NOW, "unknown")).toBe(base);
    expect(computeLeadScore(sig, { absentee: false }, NOW)).toBe(base);
  });
  it("stacks with the absentee multiplier", () => {
    expect(computeLeadScore(sig, { absentee: true }, NOW, "high")).toBe(
      Math.round(
        SCORE_CONFIG.typeWeights["code-violation"] *
          SCORE_CONFIG.absenteeMultiplier *
          SCORE_CONFIG.equityMultipliers.high,
      ),
    );
  });
});
