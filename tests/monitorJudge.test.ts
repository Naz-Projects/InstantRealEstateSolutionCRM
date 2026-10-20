// The per-listing judge on Claude Sonnet 5.5 (official Anthropic SDK): pure request
// builder + message -> verdict, testable without the network.
import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { JUDGE_MODEL_DEFAULT, judgeModel, buildJudgeRequest, verdictFromMessage, JUDGE_SCHEMA } from "../src/scraper/monitorJudge";
import { JUDGE_SYSTEM } from "../src/scraper/monitorListings";

const REC = { address: "1 X St", listPrice: 100000, conservativeArv: 200000, spreadPct: 50, description: "as-is" };
const VERDICT = {
  keep: true, matchedRequirements: ["fixer"], renovated: false, conditionTier: "moderate", valueAddScope: "kitchen",
  redFlags: [], verifyGates: [], exitTriage: "FLIP", exitFallbacks: ["WHOLESALE"], breakdown: "b", confidence: "high",
  conditionNotes: "n", reason: "r",
};
const msg = (content: unknown[], stop_reason = "end_turn") => ({ content, stop_reason } as unknown as Anthropic.Beta.BetaMessage);

describe("judge model", () => {
  it("defaults to claude-sonnet-5-5; MONITOR_LLM_MODEL overrides (blank = default)", () => {
    expect(JUDGE_MODEL_DEFAULT).toBe("claude-sonnet-5-5");
    expect(judgeModel(undefined)).toBe("claude-sonnet-5-5");
    expect(judgeModel("  ")).toBe("claude-sonnet-5-5");
    expect(judgeModel(" claude-opus-5-5 ")).toBe("claude-opus-5-5");
  });
});

describe("buildJudgeRequest", () => {
  const r = buildJudgeRequest(REC, "claude-sonnet-5-5") as unknown as Record<string, any>;
  it("cached stable system prompt + per-listing user message", () => {
    expect(r.system).toEqual([{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content).toContain("address: 1 X St");
  });
  it("structured JSON output at medium effort, 4000 max tokens, refusal fallback opted in", () => {
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.max_tokens).toBe(4000);
    expect(r.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } });
    expect(r.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(r.fallbacks).toBe("default");
  });
  it("never sends temperature or a thinking config (both 400 on this model)", () => {
    expect("temperature" in r).toBe(false);
    expect("thinking" in r).toBe(false);
  });
  it("schema: every object closed, every field required, no length constraints", () => {
    expect(JUDGE_SCHEMA.additionalProperties).toBe(false);
    expect([...JUDGE_SCHEMA.required].sort()).toEqual(Object.keys(JUDGE_SCHEMA.properties).sort());
    expect(JSON.stringify(JUDGE_SCHEMA)).not.toMatch(/maxLength|minLength|minimum|maximum/);
  });
});

describe("through the real SDK (stubbed fetch, no network)", () => {
  it("sends the beta header + fallbacks/output_config body and the verdict round-trips", async () => {
    const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
    let url = "", headers: Headers | null = null, body: any = null;
    const fetch = async (u: any, init: any) => {
      url = String(u); headers = new Headers(init.headers); body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: JSON.stringify(VERDICT) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new AnthropicSDK({ apiKey: "test-key", fetch: fetch as any, maxRetries: 0 });
    const v = verdictFromMessage(await client.beta.messages.create(buildJudgeRequest(REC, "claude-sonnet-5-5")));
    expect(url).toContain("/v1/messages");
    expect(headers!.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(headers!.get("x-api-key")).toBe("test-key");
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 4000, fallbacks: "default", output_config: { effort: "medium" } });
    expect(body.output_config.format.type).toBe("json_schema");
    expect("betas" in body).toBe(false); // betas travel as the header, not the body
    expect(v).toMatchObject({ keep: true, exitTriage: "FLIP" });
  });
});

describe("verdictFromMessage", () => {
  it("skips the (empty) thinking block and a fallback block, parses the text block", () => {
    const v = verdictFromMessage(msg([
      { type: "thinking", thinking: "", signature: "s" },
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } },
      { type: "text", text: JSON.stringify(VERDICT) },
    ]));
    expect(v).toMatchObject({ keep: true, conditionTier: "moderate", exitTriage: "FLIP", confidence: "high" });
  });
  it("refusal -> null (deterministic math stands)", () => {
    expect(verdictFromMessage(msg([{ type: "text", text: JSON.stringify(VERDICT) }], "refusal"))).toBeNull();
  });
  it("max_tokens (truncated JSON) -> null", () => {
    expect(verdictFromMessage(msg([{ type: "text", text: '{"keep":tr' }], "max_tokens"))).toBeNull();
  });
  it("no text block / unparseable text -> null", () => {
    expect(verdictFromMessage(msg([{ type: "thinking", thinking: "", signature: "s" }]))).toBeNull();
    expect(verdictFromMessage(msg([{ type: "text", text: "looks fine" }]))).toBeNull();
  });
});
