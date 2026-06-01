// Legal Notices pipeline — ported from the n8n "Legal Notices V3" workflow.
// Flow: scrape the NCC Legal Notices page -> find the latest "New Castle Weekly"
// PDF -> Firecrawl the PDF to markdown -> LLM-extract estate listings (via
// OpenRouter) -> (callers can Zillow-enrich with scrapeZillow).
//
// Unlike Sheriff Sales (structured tables), legal notices are prose, so this
// uses an LLM for extraction — the one place an LLM key is needed.

import { firecrawlScrape } from "./firecrawl.js";

export const LEGAL_NOTICES_PAGE = "https://www.newcastlede.gov/777/Legal-Notices";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.LEGAL_LLM_MODEL || "anthropic/claude-3.5-haiku";

export interface LegalListing {
  weekDate: string | null;
  title: string;
  ownerName: string;
  address: string;
  personalRepresentative: string;
}

/**
 * Find the latest "New Castle Weekly Notices" PDF link from the page content
 * (markdown or HTML). Returns the absolute PDF URL + the date found. Pure.
 */
export function findLatestLegalPdfUrl(
  content: string,
): { pdfUrl: string; dateFound: string | null } | null {
  const candidates: { url: string; text: string; date: string | null }[] = [];

  // Markdown links: [text](url) where url hits DocumentCenter/View
  const mdRe = /\[([^\]]*)\]\((https?:\/\/[^)]*DocumentCenter\/View[^)\s]*|\/[^)\s]*DocumentCenter\/View[^)\s]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(content)) !== null) {
    candidates.push({ text: m[1], url: m[2], date: dateOf(m[1]) });
  }
  // HTML anchors as a fallback (text may contain nested tags)
  const htmlRe = /<a[^>]+href=["']([^"']*DocumentCenter\/View[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = htmlRe.exec(content)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    candidates.push({ text, url: m[1], date: dateOf(text) });
  }

  const weekly = candidates.filter((c) => c.text.toLowerCase().includes("new castle weekly"));
  if (weekly.length === 0) return null;

  weekly.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  const latest = weekly[0];
  let pdfUrl = latest.url;
  if (pdfUrl.startsWith("/")) pdfUrl = "https://www.newcastlede.gov" + pdfUrl;
  return { pdfUrl, dateFound: latest.date };
}

function dateOf(text: string): string | null {
  const d = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
}

const SYSTEM_PROMPT =
  "You are a data extraction assistant specializing in legal documents. You extract structured data from New Castle County, Delaware estate/probate legal notices with perfect accuracy.";

function buildPrompt(pdfText: string): string {
  return `Extract ALL estate listings from the following legal notice document text.

For each listing, return a JSON array of objects with these exact fields:
- title: The full title line, e.g. "Estate of GEORGE E. ABBOTT JR., Deceased"
- owner_name: Just the deceased person's full name, e.g. "GEORGE E. ABBOTT JR."
- address: The deceased's home address found after "late of" in the notice text, e.g. "15 MCCORD DRIVE, NEWARK, DE 19713"
- personal_representative: The name(s) listed as Personal Representative

Rules:
1. Extract EVERY listing - do not skip any.
2. The address is always the deceased's residence found after the phrase "late of".
3. Do NOT confuse the attorney/law firm address block with the deceased's home address.
4. If a field is missing or unclear, use "N/A".
5. Return ONLY valid JSON - no markdown fences, no explanation, no extra text.

Document Text:
${pdfText}`;
}

/** Extract estate listings from PDF text using an LLM via OpenRouter. */
export async function extractLegalListings(
  pdfText: string,
  openrouterKey: string,
  weekDate: string | null = null,
): Promise<LegalListing[]> {
  if (!openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
  if (!pdfText || pdfText.length < 100) {
    throw new Error(`PDF text too short for extraction (${pdfText?.length ?? 0} chars)`);
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(pdfText) },
      ],
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let content = json.choices?.[0]?.message?.content ?? "";
  content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: Array<Record<string, string>>;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Failed to parse LLM JSON: ${(e as Error).message}\nRaw: ${content.slice(0, 500)}`,
    );
  }

  return parsed.map((l) => ({
    weekDate,
    title: l.title || "N/A",
    ownerName: l.owner_name || "N/A",
    address: l.address || "N/A",
    personalRepresentative: l.personal_representative || "N/A",
  }));
}

/** Scrape the page, find the latest weekly PDF, and return its markdown text. */
export async function fetchLatestLegalNoticesPdf(
  firecrawlKey: string,
): Promise<{ pdfText: string; pdfUrl: string; dateFound: string | null }> {
  const page = await firecrawlScrape({
    url: LEGAL_NOTICES_PAGE,
    apiKey: firecrawlKey,
    formats: ["markdown", "rawHtml"],
    timeoutMs: 60000,
  });
  const found = findLatestLegalPdfUrl(page.markdown) ?? findLatestLegalPdfUrl(page.rawHtml);
  if (!found) throw new Error("No 'New Castle Weekly' PDF link found on the Legal Notices page");

  const pdf = await firecrawlScrape({
    url: found.pdfUrl,
    apiKey: firecrawlKey,
    formats: ["markdown"],
    timeoutMs: 60000,
  });
  return { pdfText: pdf.markdown, pdfUrl: found.pdfUrl, dateFound: found.dateFound };
}
