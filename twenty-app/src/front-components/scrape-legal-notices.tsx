// Front component: the "Scrape Legal Notices This Week" button.
// Headless + CommandModal; POSTs to the legal scrape logic function.

import { defineFrontComponent } from "twenty-sdk/define";
import { CommandModal, enqueueSnackbar } from "twenty-sdk/front-component";
import { callAppRoute } from "../shared/call-app-route";

export const SCRAPE_LEGAL_FC_UID = "4d5e6f70-8192-4a3b-9c4d-5e6f7a8b9ca0";

interface LegalScrapeResult {
  skipped?: boolean;
  weekDate?: string;
  existing?: number;
  created?: number;
}

const ScrapeLegalNotices = () => {
  const execute = async () => {
    const result = await callAppRoute<LegalScrapeResult>("/legal/scrape", { force: false });
    if (result.skipped) {
      await enqueueSnackbar({
        message: `Week ${result.weekDate ?? ""} already scraped (${result.existing ?? 0} notices).`,
        variant: "info",
      });
    } else {
      await enqueueSnackbar({
        message: `Legal notices ${result.weekDate ?? ""}: ${result.created ?? 0} created — enriching now.`,
        variant: "success",
      });
    }
  };

  return (
    <CommandModal
      title="Scrape Legal Notices This Week"
      subtitle="Pull the latest NCC weekly legal-notices PDF, extract estate listings, and enrich with Zillow."
      execute={execute}
      confirmButtonText="Scrape now"
    />
  );
};

export default defineFrontComponent({
  universalIdentifier: SCRAPE_LEGAL_FC_UID,
  name: "scrape-legal-notices",
  description: "Button that triggers a legal-notices scrape for the current week.",
  isHeadless: true,
  component: ScrapeLegalNotices,
});
