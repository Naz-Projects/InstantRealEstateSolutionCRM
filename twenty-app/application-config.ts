// Twenty application manifest for the IRES Sheriff Sales app.
// The default role must grant read/write on the custom objects so the logic
// functions' CoreApiClient (scoped to this role) can create/update records.

import { defineApplication } from "twenty-sdk/define";

export const APPLICATION_UID = "c3e5a7b9-2133-4455-8779-9bc3d5e7f9a3";

export default defineApplication({
  universalIdentifier: APPLICATION_UID,
  displayName: "IRES Sheriff Sales",
  description:
    "Instant Real Estate Solution — automated New Castle County sheriff-sale ingestion, parcel + Zillow enrichment, and a wholesaling deal pipeline.",
  logoUrl: "logo.svg", // public/logo.svg — shown in the marketplace/app listing
  // defaultRoleUniversalIdentifier: "<role-uid>", // see src/roles via `yarn twenty dev:add role`
});
