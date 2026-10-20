// The per-listing Monitor judge on Claude (official Anthropic SDK). Pure: the request
// builder and the message -> verdict step; convex/monitorActions.ts owns the client and
// the call. The judge only annotates (condition / exit read / red flags) — evaluateDeal
// decides. Same prompt intent and JudgeVerdict shape as the old DeepSeek judge; the
// tolerant parseJudgeResponse still reads the text.
import type Anthropic from "@anthropic-ai/sdk";
import { JUDGE_SYSTEM, buildJudgePrompt, parseJudgeResponse, type JudgeVerdict } from "./monitorListings";

export const JUDGE_MODEL_DEFAULT = "claude-sonnet-5-5";
export function judgeModel(env: string | undefined): string {
  return (env ?? "").trim() || JUDGE_MODEL_DEFAULT;
}

// Structured output for the JudgeVerdict shape. Closed objects, every field required,
// nullable = anyOf null; no length/number constraints (the parser truncates instead).
const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const nullableEnum = (values: readonly string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    keep: { type: "boolean" },
    matchedRequirements: { type: "array", items: { type: "string", enum: ["below_market", "fixer", "distressed", "flip"] } },
    renovated: { type: "boolean" },
    conditionTier: nullableEnum(["cosmetic", "moderate", "systems", "structural"]),
    valueAddScope: { anyOf: [str, { type: "null" }] },
    redFlags: strArr,
    verifyGates: strArr,
    exitTriage: nullableEnum(["FLIP", "WHOLETAIL", "RENTAL", "WHOLESALE", "PASS"]),
    exitFallbacks: strArr,
    breakdown: { anyOf: [str, { type: "null" }] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    conditionNotes: str,
    reason: str,
  },
  required: [
    "keep", "matchedRequirements", "renovated", "conditionTier", "valueAddScope", "redFlags", "verifyGates",
    "exitTriage", "exitFallbacks", "breakdown", "confidence", "conditionNotes", "reason",
  ],
  additionalProperties: false,
} as const;

// Stable rubric in `system` (cached), the listing in the user turn. No `temperature` and no
// `thinking` (both 400 on Sonnet 5.5); effort is the depth control. Refusals opt into the
// server-side fallback ("default" routes by refusal category).
export function buildJudgeRequest(rec: unknown, model: string): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildJudgePrompt(rec) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

// stop_reason first: a refusal (the whole fallback chain declined) or a max_tokens cut
// (thinking counts toward it; the JSON is truncated) is no verdict. Content can lead with
// an empty thinking block and carry fallback blocks, so read the text block.
export function verdictFromMessage(msg: Anthropic.Beta.BetaMessage): JudgeVerdict | null {
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return null;
  const text = msg.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  return text ? parseJudgeResponse(text.text) : null;
}
