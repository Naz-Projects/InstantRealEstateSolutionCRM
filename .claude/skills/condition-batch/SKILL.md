---
name: condition-batch
description: Score the top N leads' exterior condition by looking at each house in Google Maps Street View via Chrome (Claude vision, no paid API) and writing score + flags + description + confidence + screenshot into Convex. Use when the user says "score conditions", "run condition scoring", "condition batch", or wants the monthly house-condition pass.
---

# Condition Batch Scoring

Run this monthly. It scores the **top N leads** (default 100) by driving the user's logged-in Chrome to each house's Google Maps Street View, looking at it with the SAME rubric the code uses, and writing the result to Convex. No paid LLM API — Claude does the vision.

## 0. Preconditions
- Confirm the backend is deployed (the `description`/`confidence`/`rubricVersion` fields + `topLeadsForScoring` + `storeCondition` + `generateConditionUploadUrl` must be live on the target deployment).
- Target = PROD by default: `export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"`.
- Load claude-in-chrome tools and call `tabs_context_mcp` first; create a fresh tab for the run.
- Make a scratch dir for screenshots + the resume log: `mkdir -p scratch`.

## 1. Pull the work list
`npx convex run signalData:topLeadsForScoring '{"count":100}'` → a JSON array of `{prclid, address, leadScore, ownerName}`. Keep a resume log of prclids completed this run (e.g. `scratch/condition-done.log`, one prclid per line) so a mid-run interruption resumes without rescoring — **skip any prclid already in the log.**

## 2. For each lead, SERIALLY (one Chrome, one focus):
1. Navigate Chrome to Google Maps Street View for `address` (e.g. `https://www.google.com/maps/place/<url-encoded address>`, then enter Street View / pegman). Confirm the on-screen address/area matches the target; if it clearly doesn't, set confidence "low".
2. If Maps shows NO Street View coverage → the upload + scoring is SKIPPED; instead record it as no-coverage (mark `hasImagery:false` via a `storeCondition` run — see 5 — so it isn't silently dropped) and move on. **Never guess a score with no image.**
3. Capture a Street View screenshot of the front of the house and SAVE the bytes to `scratch/<prclid>.png` (step 5b reads this file). **If the screenshot tool can't write to disk,** fall back to fetching the equivalent Street View Static image straight to disk — Claude still scored the live Chrome view; this is the STORED thumbnail only (free under the Maps credit):
   `key=$(grep ^VITE_GOOGLE_MAPS_API_KEY= .env.local | cut -d= -f2-); curl -sS -G "https://maps.googleapis.com/maps/api/streetview" --data-urlencode "location=<address>" --data "size=640x640&fov=80&source=outdoor&key=$key" -o scratch/<prclid>.jpg`
4. SCORE the screenshot with THIS rubric (kept byte-for-byte in sync with `src/scraper/conditionScore.ts` `buildConditionPrompt`, RUBRIC_VERSION 2) — describe what is clearly visible FIRST, then flags (only what you described, from the closed set), then a 0-100 score, then confidence. **DO NOT invent damage**; when unsure, score low + confidence low. The exact rubric the model must follow:

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

   - To keep the main context lean, dispatch a per-house scoring subagent that READS `scratch/<prclid>.jpg` and returns the JSON; if subagents cannot reach the screenshot file, score inline.
5. Write it via the upload-URL flow (base64 can't fit a CLI arg; convex.cloud HTTP works). Let `F` = the saved file (`scratch/<prclid>.png` or the `.jpg` fallback) and `CT` = its content type (`image/png` or `image/jpeg`):
   a. `url=$(npx convex run conditionData:generateConditionUploadUrl '{}' | tr -d '"[:space:]')` — strips the CLI's surrounding quotes/whitespace, leaving the bare upload URL.
   b. `resp=$(curl -sS -X POST "$url" -H "Content-Type: $CT" --data-binary @"$F")` → JSON `{"storageId":"<id>"}`; `id=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).storageId)" "$resp")`.
   c. Build the payload with `node` so a `'`/`"`/newline in the description can't break the shell or JSON, then write it:
      ```bash
      payload=$(node -e 'const a=process.argv.slice(1);console.log(JSON.stringify({prclid:a[0],score:+a[1],flags:JSON.parse(a[2]),description:a[3],confidence:a[4],rubricVersion:2,model:"claude-opus-4-8 (chrome)",imageStorageId:a[5],hasImagery:true,scoredAt:Date.now(),lastError:null}))' "<prclid>" "<score>" '<flags-json-array>' "<description>" "<low|medium|high>" "$id")
      npx convex run conditionData:storeCondition "$payload"
      ```
   For a no-coverage house, skip the upload and call `storeCondition` with `'{"prclid":"<prclid>","hasImagery":false,"model":"claude-opus-4-8 (chrome)","scoredAt":<ms>,"lastError":null}'` (no score) so it's recorded, not silently dropped (`<ms>` = `$(($(date +%s)*1000))`).
6. Append the prclid to the resume log (`scratch/condition-done.log`).

## 3. Handle friction
- If Google shows a CAPTCHA/consent wall, **PAUSE** and ask the user to clear it, then resume from the log (the done-prclids are skipped, so no rescoring). **Pace requests** — a short wait between houses to avoid tripping rate limits / CAPTCHAs.

## 4. Summary
Report: scored / no-coverage / low-confidence / distressed (score ≥ 60) counts, and a list of the worst few (highest scores). **Remind the user that low-confidence rows need human eyeballing** — eyeball the `/condition` page and flag any wrong scores (we tune the rubric + bump RUBRIC_VERSION).
