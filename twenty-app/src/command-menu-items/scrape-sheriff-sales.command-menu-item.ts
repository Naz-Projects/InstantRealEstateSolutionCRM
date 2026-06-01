// Surfaces the scrape front component as a pinned quick-action button (top-right)
// and a Cmd+K command, available everywhere in the workspace.

import { defineCommandMenuItem } from "twenty-sdk/define";
import { SCRAPE_BUTTON_FC_UID } from "../front-components/scrape-sheriff-sales";

export default defineCommandMenuItem({
  universalIdentifier: "f2a3b4c5-d6e7-4899-ab0c-2d3e4f5a6b71",
  label: "Scrape Sheriff Sales This Week",
  shortLabel: "Scrape Sales",
  icon: "IconGavel",
  isPinned: true,
  availabilityType: "GLOBAL",
  frontComponentUniversalIdentifier: SCRAPE_BUTTON_FC_UID,
});
