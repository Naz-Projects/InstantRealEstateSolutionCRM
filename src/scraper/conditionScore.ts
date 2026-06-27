// P7 vision condition scoring — pure, offline-testable core for the /condition
// test page. Builds the Street View URLs + the vision-LLM prompt and parses the
// model's JSON reply into a clamped score. No network, no Convex. Mirrors
// legalNotices.ts (OpenRouter, prompt-instructed JSON, fence-stripping parse).
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

export const CONDITION_MODEL =
  process.env.CONDITION_LLM_MODEL || "google/gemini-2.5-flash";

// A/B alternatives the user can flip via CONDITION_LLM_MODEL on the test page.
export const CONDITION_MODEL_ALTERNATIVES = [
  "google/gemini-2.5-flash",
  "z-ai/glm-4.6v",
  "qwen/qwen3-vl-32b-instruct",
] as const;

// Bump when the rubric materially changes so stale-version rows can be re-scored.
export const RUBRIC_VERSION = 2;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
const KNOWN_CONFIDENCE = new Set<string>(CONFIDENCE_LEVELS);

// Closed flag vocabulary — the model may only return flags from this set.
export const CONDITION_FLAGS = [
  "overgrown_vegetation",
  "junk_debris",
  "boarded_or_broken_windows",
  "roof_damage_or_tarp",
  "distressed_exterior",
  "vacant_appearance",
] as const;
export type ConditionFlag = (typeof CONDITION_FLAGS)[number];

export interface ConditionScore {
  score: number; // 0–100, clamped (higher = more distressed)
  flags: string[]; // subset of CONDITION_FLAGS
  reason: string; // kept for back-compat with v1 rows
  description: string; // evidence-grounded narrative (v2)
  confidence: "" | Confidence; // "" = model gave none / invalid
}

export const CONDITION_SYSTEM_PROMPT =
  "You are a property-condition assessor for a real-estate wholesaling team. You judge " +
  "the visible EXTERIOR condition/distress of a house from a single street-level photo, " +
  "objectively and conservatively. You report only what is clearly visible.";

export function buildConditionPrompt(): string {
  return `You are assessing the EXTERIOR physical condition / distress of the house in this Street View photo for a real-estate wholesaling team. Accuracy matters more than completeness — DO NOT invent damage.

Work in this order, then return ONLY a JSON object (no markdown fences, no extra text) with exactly these fields:

1. "description": 1-3 sentences describing what is CLEARLY VISIBLE on the house and lot (structure type, roof, siding/paint, windows, yard, debris). Cite only what you can actually see. If the view is obstructed, shadowed, the wrong building, under construction, or not a house, SAY SO here.
2. "flags": an array containing ONLY clearly-visible items you described above, from this exact set:
   "overgrown_vegetation", "junk_debris", "boarded_or_broken_windows",
   "roof_damage_or_tarp", "distressed_exterior", "vacant_appearance"
   Use [] if none clearly apply. Never add a flag you did not describe.
3. "score": an integer 0-100 distress score justified by the description:
     0-20  = well-kept (tidy yard, sound roof/siding/windows, no distress)
     21-50 = minor wear (some peeling paint / worn but maintained)
     51-75 = visible distress (overgrown yard, debris, damaged siding/roof, disrepair)
     76-100 = severe distress / likely vacant (boarded windows, tarped/collapsing roof, heavy junk, derelict)
4. "confidence": "low", "medium", or "high" — your confidence the photo clearly shows the target house's current condition. Use "low" if the view is obstructed, shadowed, ambiguous, possibly the wrong house, or stale-looking.

Rules:
- Judge ONLY what is clearly visible. When unsure, score conservatively (low) and set confidence "low".
- Shadows, wet pavement, parked cars, and seasonal bare trees are NOT distress.`;
}

const KNOWN_FLAGS = new Set<string>(CONDITION_FLAGS);

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Tolerant parse of the model's reply. Strips ```json fences, grabs the first
 *  {...} block, JSON.parses, clamps the score, keeps only known flags. Throws only
 *  when no JSON object can be recovered (the caller catches → lastError). */
export function parseConditionResponse(raw: string): ConditionScore {
  const cleaned = (raw ?? "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object in condition response: ${cleaned.slice(0, 200)}`);
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Failed to parse condition JSON: ${(e as Error).message}`);
  }
  const flags = Array.isArray(obj.flags)
    ? obj.flags.map(String).filter((f) => KNOWN_FLAGS.has(f))
    : [];
  const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 300) : "";
  const description = typeof obj.description === "string" ? obj.description.slice(0, 1000) : "";
  const confRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  const confidence = KNOWN_CONFIDENCE.has(confRaw) ? (confRaw as Confidence) : "";
  return { score: clampScore(obj.score), flags: [...new Set(flags)], reason, description, confidence };
}

/** Google Street View Static image URL for a situs address. */
export function buildStreetViewImageUrl(address: string, key: string): string {
  const params = new URLSearchParams({
    location: address,
    size: "640x640",
    fov: "80",
    source: "outdoor",
    return_error_code: "true",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

/** Free Street View metadata URL (coverage check; quota-exempt). */
export function buildStreetViewMetadataUrl(address: string, key: string): string {
  const params = new URLSearchParams({ location: address, source: "outdoor", key });
  return `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
}

export type StreetViewCoverage =
  | { kind: "ok" }
  | { kind: "no_imagery" }
  | { kind: "error"; message: string };

/** Classify a Street View metadata response. "OK" = coverage exists; "ZERO_RESULTS"/
 *  "NOT_FOUND" = genuinely no panorama for this address; ANY other status
 *  (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST, …) is a hard config/quota
 *  error we surface instead of silently treating as "no coverage". */
export function classifyStreetViewMetadata(meta: {
  status?: string;
  error_message?: string;
}): StreetViewCoverage {
  const status = meta?.status;
  if (status === "OK") return { kind: "ok" };
  if (status === "ZERO_RESULTS" || status === "NOT_FOUND") return { kind: "no_imagery" };
  const detail = meta?.error_message ? `: ${meta.error_message}` : "";
  return { kind: "error", message: `Street View metadata ${status ?? "unknown"}${detail}` };
}
