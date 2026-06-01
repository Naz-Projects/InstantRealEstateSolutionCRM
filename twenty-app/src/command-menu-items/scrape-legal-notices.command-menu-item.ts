import { defineCommandMenuItem } from "twenty-sdk/define";
import { SCRAPE_LEGAL_FC_UID } from "../front-components/scrape-legal-notices";

export default defineCommandMenuItem({
  universalIdentifier: "5e6f7081-92a3-4b4c-9d5e-6f7a8b9cadb0",
  label: "Scrape Legal Notices This Week",
  shortLabel: "Scrape Notices",
  icon: "IconScale",
  isPinned: true,
  availabilityType: "GLOBAL",
  frontComponentUniversalIdentifier: SCRAPE_LEGAL_FC_UID,
});
