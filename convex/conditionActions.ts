"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  CONDITION_MODEL,
  CONDITION_SYSTEM_PROMPT,
  buildConditionPrompt,
  buildStreetViewImageUrl,
  buildStreetViewMetadataUrl,
  classifyStreetViewMetadata,
  parseConditionResponse,
  RUBRIC_VERSION,
} from "../src/scraper/conditionScore";

// P7 vision condition scoring — funnel-only action for the /condition test page.
// Per-lead only (NO batch, NO cron). ISOLATED from /leads scoring.
// Flow: spine address → Street View coverage (free) → image → _storage → vision LLM → store.
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ScoreResult =
  | { status: "ok"; score: number; flags: string[] }
  | { status: "no_imagery" }
  | { status: "error"; error: string };

async function doScore(ctx: ActionCtx, prclid: string): Promise<ScoreResult> {
  const mapsKey = (process.env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
  const orKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!mapsKey) throw new Error("GOOGLE_GEOCODING_API_KEY is not set");
  if (!orKey) throw new Error("OPENROUTER_API_KEY is not set");

  const parcel = await ctx.runQuery(internal.conditionData.getParcelInternal, { prclid });
  if (!parcel) throw new Error(`No spine parcel for prclid ${prclid}`);
  const address = `${parcel.situsStreet}, ${parcel.propCity} ${parcel.propState} ${parcel.propZip}`;

  // 1) Free coverage check (metadata endpoint is quota-exempt).
  try {
    const metaRes = await fetch(buildStreetViewMetadataUrl(address, mapsKey), {
      signal: AbortSignal.timeout(30_000),
    });
    const meta = (await metaRes.json()) as { status?: string; error_message?: string };
    const coverage = classifyStreetViewMetadata(meta);
    if (coverage.kind === "no_imagery") {
      await ctx.runMutation(internal.conditionData.storeCondition, {
        prclid,
        hasImagery: false,
        model: CONDITION_MODEL,
        scoredAt: Date.now(),
        lastError: null,
      });
      return { status: "no_imagery" };
    }
    if (coverage.kind === "error") {
      await ctx.runMutation(internal.conditionData.storeCondition, {
        prclid,
        lastError: coverage.message,
      });
      return { status: "error", error: coverage.message };
    }
  } catch (e) {
    const msg = `Street View metadata: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, { prclid, lastError: msg });
    return { status: "error", error: msg };
  }

  // 2) Fetch the image, store it in _storage, keep base64 for the model.
  let imageStorageId: Id<"_storage"> | undefined;
  let b64 = "";
  try {
    const imgRes = await fetch(buildStreetViewImageUrl(address, mapsKey), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) throw new Error(`Street View HTTP ${imgRes.status}`);
    const bytes = await imgRes.arrayBuffer();
    imageStorageId = await ctx.storage.store(new Blob([bytes], { type: "image/jpeg" }));
    b64 = Buffer.from(bytes).toString("base64");
  } catch (e) {
    const msg = `Street View image: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      hasImagery: true,
      lastError: msg,
    });
    return { status: "error", error: msg };
  }

  // 3) Vision LLM via OpenRouter (mirrors legalNotices; user message carries the image).
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: CONDITION_MODEL,
        messages: [
          { role: "system", content: CONDITION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: buildConditionPrompt() },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseConditionResponse(raw);
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      score: parsed.score,
      flags: parsed.flags,
      reason: parsed.reason,
      description: parsed.description,
      confidence: parsed.confidence || undefined,
      rubricVersion: RUBRIC_VERSION,
      model: CONDITION_MODEL,
      imageStorageId,
      hasImagery: true,
      rawResponse: raw.slice(0, 2000),
      scoredAt: Date.now(),
      lastError: null,
    });
    return { status: "ok", score: parsed.score, flags: parsed.flags };
  } catch (e) {
    const msg = `Vision LLM: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      imageStorageId,
      hasImagery: true,
      lastError: msg,
    });
    return { status: "error", error: msg };
  }
}

// Per-lead button: score one parcel now (auth-gated). NO batch.
export const scoreCondition = action({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }): Promise<ScoreResult> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    return await doScore(ctx, prclid);
  },
});
