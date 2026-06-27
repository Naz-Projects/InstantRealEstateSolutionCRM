import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { parseConditionResponse, RUBRIC_VERSION } from "../src/scraper/conditionScore";

// P7 vision condition scoring — V8 data layer for the /condition test page.
// Funnel-only; ISOLATED from /leads scoring.
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

// The spine parcel for one prclid — the action re-reads the address here rather
// than trusting a client-passed one (same discipline as equityData.getParcelInternal).
export const getParcelInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

// Upsert the condition result (written only by the action). Passing lastError:null
// CLEARS a stale error on success (patch removes the field via undefined).
export const storeCondition = internalMutation({
  args: {
    prclid: v.string(),
    score: v.optional(v.number()),
    flags: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
    description: v.optional(v.string()),
    confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    rubricVersion: v.optional(v.number()),
    model: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    hasImagery: v.optional(v.boolean()),
    rawResponse: v.optional(v.string()),
    scoredAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { prclid, lastError, ...rest } = args;
    const now = Date.now();
    const patch = { ...rest, lastError: lastError ?? undefined, updatedAt: now };
    const existing = await ctx.db
      .query("parcelCondition")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("parcelCondition", { prclid, ...patch });
    }
  },
});

// The condition-batch skill POSTs the RAW model JSON here; we run it through the
// SAME canonical parser as the Gemini path (clamps score 0-100, filters flags to
// the closed set, validates confidence) so the skill cannot write unsanitized data.
// On unparseable output we store a visible lastError instead of a fabricated score.
export const recordConditionScore = internalMutation({
  args: {
    prclid: v.string(),
    rawJson: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    model: v.string(),
  },
  handler: async (ctx, { prclid, rawJson, imageStorageId, model }) => {
    const now = Date.now();
    let patch: Omit<Doc<"parcelCondition">, "_id" | "_creationTime" | "prclid">;
    try {
      const p = parseConditionResponse(rawJson);
      patch = {
        score: p.score,
        flags: p.flags,
        reason: p.reason,
        description: p.description,
        confidence: p.confidence || undefined,
        rubricVersion: RUBRIC_VERSION,
        model,
        imageStorageId,
        hasImagery: true,
        rawResponse: rawJson.slice(0, 2000),
        scoredAt: now,
        lastError: undefined,
        updatedAt: now,
      };
    } catch (e) {
      patch = {
        model,
        imageStorageId,
        hasImagery: true,
        lastError: (e as Error).message,
        scoredAt: now,
        updatedAt: now,
      };
    }
    const existing = await ctx.db
      .query("parcelCondition")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("parcelCondition", { prclid, ...patch });
  },
});

// The condition-batch skill POSTs the Street View screenshot bytes to this URL,
// gets a storageId, then calls storeCondition with imageStorageId. (CLI args are
// too small for base64; the upload-URL flow carries the bytes over HTTP.)
export const generateConditionUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Condition rows for a set of prclids, each with a resolved image URL for display.
export const conditionForPrclids = query({
  args: { prclids: v.array(v.string()) },
  handler: async (ctx, { prclids }) => {
    await requireUser(ctx);
    const out: Array<{
      prclid: string;
      score: number | null;
      flags: string[];
      reason: string;
      description: string;
      confidence: string;
      model: string | null;
      hasImagery: boolean | null;
      scoredAt: number | null;
      lastError: string | null;
      imageUrl: string | null;
    }> = [];
    for (const prclid of prclids) {
      const row = await ctx.db
        .query("parcelCondition")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .first();
      if (!row) continue;
      const imageUrl = row.imageStorageId ? await ctx.storage.getUrl(row.imageStorageId) : null;
      out.push({
        prclid: row.prclid,
        score: row.score ?? null,
        flags: row.flags ?? [],
        reason: row.reason ?? "",
        description: row.description ?? "",
        confidence: row.confidence ?? "",
        model: row.model ?? null,
        hasImagery: row.hasImagery ?? null,
        scoredAt: row.scoredAt ?? null,
        lastError: row.lastError ?? null,
        imageUrl,
      });
    }
    return out;
  },
});
