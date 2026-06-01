// Default application role. `defineApplicationRole()` marks it as the app's
// default — the role the logic functions' CoreApiClient (via TWENTY_APP_ACCESS_TOKEN)
// runs under. It needs read + write on this app's objects so the scrape and
// enrich functions can create and update listings.

import { defineApplicationRole } from "twenty-sdk/define";
import { SHERIFF_SALE_LISTING_UID } from "../objects/sheriff-sale-listing.object";
import { SCRAPE_RUN_UID } from "../objects/scrape-run.object";

export const IRES_APP_ROLE_UID = "5f7a9b02-6c8d-4e3f-a1b2-7c9d0e1f2a30";

export default defineApplicationRole({
  universalIdentifier: IRES_APP_ROLE_UID,
  label: "IRES Sheriff Sales App",
  description:
    "Default role for the IRES Sheriff Sales app's logic functions — read/write on its objects.",
  canBeAssignedToUsers: true,
  canBeAssignedToAgents: true,
  canBeAssignedToApiKeys: true,
  objectPermissions: [
    {
      objectUniversalIdentifier: SHERIFF_SALE_LISTING_UID,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: true,
    },
    {
      objectUniversalIdentifier: SCRAPE_RUN_UID,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
    },
  ],
});
