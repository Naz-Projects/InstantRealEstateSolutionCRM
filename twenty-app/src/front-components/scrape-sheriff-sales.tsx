// Front component: the "Scrape Sheriff Sales This Week" button.
// Headless + CommandModal: clicking the pinned quick-action opens a confirm
// dialog; on confirm it POSTs to the scrape logic function (/s/sheriff/scrape)
// and shows a snackbar. The API key stays server-side (in the logic function) —
// front components never see secrets.

import { defineFrontComponent } from "twenty-sdk/define";
import { CommandModal, enqueueSnackbar } from "twenty-sdk/front-component";
import { callAppRoute } from "../shared/call-app-route";

export const SCRAPE_BUTTON_FC_UID = "e1f2a3b4-c5d6-4788-9a0b-1c2d3e4f5a60";

interface ScrapeResult {
  skipped?: boolean;
  reason?: string;
  saleMonth?: string;
  existing?: number;
  created?: number;
  runId?: string;
}

const ScrapeSheriffSales = () => {
  const execute = async () => {
    const result = await callAppRoute<ScrapeResult>("/sheriff/scrape", {
      force: false,
    });
    if (result.skipped) {
      await enqueueSnackbar({
        message: `${result.saleMonth ?? "This month"} already scraped (${result.existing ?? 0} listings).`,
        variant: "info",
      });
    } else {
      await enqueueSnackbar({
        message: `Scraping ${result.saleMonth ?? "sheriff sales"}: ${result.created ?? 0} listings created — enriching now.`,
        variant: "success",
      });
    }
  };

  return (
    <CommandModal
      title="Scrape Sheriff Sales This Week"
      subtitle="Pull the current New Castle County sheriff-sale PDF and enrich every property with parcel + Zillow data."
      execute={execute}
      confirmButtonText="Scrape now"
    />
  );
};

export default defineFrontComponent({
  universalIdentifier: SCRAPE_BUTTON_FC_UID,
  name: "scrape-sheriff-sales",
  description: "Button that triggers a sheriff-sales scrape for the current month.",
  isHeadless: true,
  component: ScrapeSheriffSales,
});
