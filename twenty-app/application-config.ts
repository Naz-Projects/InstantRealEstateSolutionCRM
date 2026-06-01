// Twenty application manifest for Instant Real Estate Solution.
// Declares the two secrets the logic functions need (read via process.env),
// so the workspace prompts for them on install. The default role lives in
// src/roles (defineApplicationRole).

import { defineApplication } from "twenty-sdk/define";

export const APPLICATION_UID = "c3e5a7b9-2133-4455-8779-9bc3d5e7f9a3";

export default defineApplication({
  universalIdentifier: APPLICATION_UID,
  displayName: "Instant Real Estate Solution",
  description:
    "IRES deal engine — automated New Castle County sheriff-sale + legal-notice ingestion, parcel + Zillow enrichment, and a wholesaling deal pipeline.",
  logoUrl: "logo.svg",
  applicationVariables: {
    FIRECRAWL_API_KEY: {
      universalIdentifier: "d4f6a8b0-3244-4566-988a-acd4e6f80b41",
      isSecret: true,
      description: "Firecrawl API key — powers all scraping (sheriff PDF, parcel lookup, Zillow, legal-notices PDF).",
    },
    OPENROUTER_API_KEY: {
      universalIdentifier: "d4f6a8b0-3244-4566-988a-acd4e6f80b42",
      isSecret: true,
      description: "OpenRouter API key — used only for Legal Notices LLM extraction.",
    },
  },
});
