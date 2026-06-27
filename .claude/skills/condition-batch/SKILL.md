---
name: condition-batch
description: Score the top N leads' exterior condition by looking at each house's Google Street View with Claude vision (NO paid LLM API) and writing score + flags + description + confidence + image into Convex. Use when the user says "score conditions", "run condition scoring", "condition batch", "score these houses on Google condition", "I have 100 more houses score them", or wants the monthly house-condition pass.
---

# Condition Batch Scoring

Run on demand (~monthly). Scores the **top N leads** (default 100) by reading each house's Google Street View with **Claude vision** and writing the result to Convex. No Gemini, no paid LLM API — Claude is the scorer; Street View images are free under the Maps credit. The `/condition` page shows the results worst-distress-first. The per-click Gemini button on that page stays as an ad-hoc fallback.

PROVEN method (used for the 2026-06-27 full-100 run, 0 errors): pull leads → download Street View images → fan out parallel Claude-vision subagents that score + write. This keeps the run fast and the main context lean. (For just one or a few houses, you can instead drive Chrome interactively — see "Interactive alternative" at the bottom.)

## 0. Preconditions
- Backend must be live on the target deployment: the `parcelCondition` fields `description`/`confidence`/`rubricVersion`, plus `signalData:topLeadsForScoring`, `conditionData:generateConditionUploadUrl`, `conditionData:recordConditionScore`, `conditionData:storeCondition`.
- Target = PROD by default: `export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"` (set this in EVERY bash block — shell env does not persist).
- `mkdir -p scratch`.
- **Fresh run:** clear the resume log so it re-scores the current top N: `: > scratch/condition-done.log`. (The log only prevents re-work after a mid-run interruption; re-scoring is an upsert by prclid, so a fresh monthly run should start clean.)

## 1. Pull the work list + download images
```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
key="$(grep ^VITE_GOOGLE_MAPS_API_KEY= .env.local | cut -d= -f2-)"
npx convex run signalData:topLeadsForScoring '{"count":100}' 2>/dev/null > scratch/leads.json   # {prclid, address, leadScore, ownerName}[]
node -e 'const L=require("./scratch/leads.json");const fs=require("fs");const done=new Set(fs.existsSync("scratch/condition-done.log")?fs.readFileSync("scratch/condition-done.log","utf8").split(/\s+/).filter(Boolean):[]);fs.writeFileSync("scratch/todo.tsv",L.filter(l=>!done.has(l.prclid)).map(l=>l.prclid+"\t"+l.address).join("\n")+"\n");'
while IFS=$'\t' read -r p a; do [ -z "$p" ] && continue; curl -sS -G "https://maps.googleapis.com/maps/api/streetview" --data-urlencode "location=$a" --data "size=640x640&fov=80&source=outdoor&key=$key" -o "scratch/$p.jpg"; done < scratch/todo.tsv
split -d -l 12 scratch/todo.tsv scratch/slice-   # → scratch/slice-00 .. slice-NN (~12 houses each)
```
A ~8.8 KB image is Google's flat-gray "Sorry, we have no imagery here" placeholder = NO COVERAGE.

## 2. Fan out parallel Claude-vision scoring subagents (one per slice)
Dispatch ONE background subagent (model `opus`) per `scratch/slice-*` file. Give each the slice path + this exact job. Each subagent, for EACH `<prclid><TAB><address>` line (image already at `scratch/<prclid>.jpg`):
1. **Read** `scratch/<prclid>.jpg` (vision).
2. **No-coverage:** if it's the flat-gray "no imagery" placeholder → run the no-coverage write (§4), no score, move on. NEVER invent a score.
3. Else **score** with THE RUBRIC (§3) and **Write** the raw JSON to `scratch/raw-<prclid>.json` (shape: `{"description":"...","flags":[...],"score":<0-100 int>,"confidence":"low|medium|high"}`).
4. **Score write** (§4) — uploads the image + records via the server-side sanitizer.
5. Append the prclid to `scratch/condition-done.log`.
Subagents run in parallel (~4 min each for 12 houses). Tell each to return a concise summary (scored / no-coverage counts + `prclid score confidence [topflag]` + any write errors).

## 3. THE RUBRIC (apply EXACTLY — verbatim from `src/scraper/conditionScore.ts` `buildConditionPrompt`, RUBRIC_VERSION 2)
```text
You are assessing the EXTERIOR physical condition / distress of the house in this Street View photo for a real-estate wholesaling team. Accuracy matters more than completeness — DO NOT invent damage.

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
- Shadows, wet pavement, parked cars, and seasonal bare trees are NOT distress.
```
- This rubric is copied verbatim from `buildConditionPrompt()`; if you edit it, update `src/scraper/conditionScore.ts` and bump `RUBRIC_VERSION` so stale-version rows can be re-scored.
- Many top leads are apartment complexes / LLC multi-family — judge the visible buildings; a maintained complex is low distress even if it's not a single house.

## 4. Write commands
**Score write** (server re-sanitizes the raw JSON via the canonical parser — clamps score, filters flags, validates confidence):
```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
prclid="<prclid>"
raw=$(cat "scratch/raw-$prclid.json")
url=$(npx convex run conditionData:generateConditionUploadUrl '{}' 2>/dev/null | tr -d '"[:space:]')
id=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).storageId)" "$(curl -sS -X POST "$url" -H "Content-Type: image/jpeg" --data-binary @"scratch/$prclid.jpg")")
payload=$(node -e 'const a=process.argv.slice(1);console.log(JSON.stringify({prclid:a[0],rawJson:a[1],imageStorageId:a[2],model:"claude-opus-4-8 (chrome)"}))' "$prclid" "$raw" "$id")
npx convex run conditionData:recordConditionScore "$payload" 2>/dev/null
echo "$prclid" >> scratch/condition-done.log
```
**No-coverage write** (placeholder image — recorded so it isn't silently dropped, with no score):
```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
ms=$(($(date +%s)*1000))
npx convex run conditionData:storeCondition '{"prclid":"<prclid>","hasImagery":false,"model":"claude-opus-4-8 (chrome)","scoredAt":'"$ms"',"lastError":null}' 2>/dev/null
echo "<prclid>" >> scratch/condition-done.log
```

## 5. Aggregate + report
- Confirm `sort -u scratch/condition-done.log | wc -l` == N.
- Pull a prod summary (inline query over `parcelCondition`): total / scored / no-coverage / flagged / confidence mix / worst dozen by score.
- Report scored vs no-coverage counts and the worst few (the actual distressed leads). **Remind the user that low-confidence rows need a human eyeball** on `/condition` — flag any wrong scores; we tune the rubric + bump RUBRIC_VERSION.

## "No false information" guardrails (the product requirement — keep them)
- Describe-then-score (description before flags/score); flags only for what was described; conservative when unsure.
- Real no-coverage → `hasImagery:false`, never a guessed score. Obstructed/dated/blurred/wrong-building → confidence "low".
- The server (`recordConditionScore`) re-runs the model JSON through the canonical `parseConditionResponse` sanitizer, so the skill can never write an out-of-range score, an invented flag, or a bad confidence.

## Interactive alternative (a FEW houses / spot-check)
For one or a handful of houses, you can drive the user's logged-in Chrome instead of the batch: load claude-in-chrome, navigate to the Street View Static image URL (or Google Maps) for the address, screenshot, score with §3, then write with §4. This honors "look through Chrome" but is too slow for the full 100 — use the §2 batch for the monthly run.
