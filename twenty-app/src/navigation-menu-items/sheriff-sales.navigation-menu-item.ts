// Sidebar entry that opens the Sheriff Sale Listings view.

import { defineNavigationMenuItem, NavigationMenuItemType } from "twenty-sdk/define";
import { SHERIFF_SALE_LISTINGS_VIEW_UID } from "../views/sheriff-sale-listings.view";

export default defineNavigationMenuItem({
  universalIdentifier: "4e6f8a01-5c7d-4e3f-a012-6b7c8d9e0f21",
  name: "Sheriff Sales",
  icon: "IconGavel",
  color: "blue",
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: SHERIFF_SALE_LISTINGS_VIEW_UID,
});
