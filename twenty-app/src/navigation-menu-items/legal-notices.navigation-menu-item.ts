import { defineNavigationMenuItem, NavigationMenuItemType } from "twenty-sdk/define";
import { LEGAL_NOTICES_VIEW_UID } from "../views/legal-notices.view";

export default defineNavigationMenuItem({
  universalIdentifier: "708192a3-b4c5-4d6e-9f70-8b9cadbecfd0",
  name: "Legal Notices",
  icon: "IconScale",
  color: "green",
  position: 1,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: LEGAL_NOTICES_VIEW_UID,
});
