import { defineNavigationMenuItem, NavigationMenuItemType } from "twenty-sdk/define";
import { SHERIFF_PIPELINE_VIEW_UID } from "../views/sheriff-pipeline.view";

export default defineNavigationMenuItem({
  universalIdentifier: "92030415-c6d7-4e8f-9081-2b3c4d5e6f70",
  name: "Deal Pipeline",
  icon: "IconLayoutKanban",
  color: "purple",
  position: 2,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: SHERIFF_PIPELINE_VIEW_UID,
});
