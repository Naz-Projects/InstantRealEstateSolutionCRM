// Kanban "Deal Pipeline" view for Sheriff Sale Listings, grouped by Deal Status
// (New -> Reviewing -> Contacted -> Offer -> Dead). This is the board the team
// drags deals across — and the basis for "how many did we look at / contact".

import { defineView, ViewKey, ViewType } from "twenty-sdk/define";
import { SHERIFF_SALE_LISTING_UID, SSL } from "../objects/sheriff-sale-listing.object";

export const SHERIFF_PIPELINE_VIEW_UID = "81920304-b5c6-4d7e-9f80-1a2b3c4d5e60";

let pos = 0;
const col = (uid: string, fieldUid: string, size = 160) => ({
  universalIdentifier: uid,
  fieldMetadataUniversalIdentifier: fieldUid,
  position: pos++,
  isVisible: true,
  size,
});

export default defineView({
  universalIdentifier: SHERIFF_PIPELINE_VIEW_UID,
  name: "Deal Pipeline",
  objectUniversalIdentifier: SHERIFF_SALE_LISTING_UID,
  icon: "IconLayoutKanban",
  key: ViewKey.INDEX,
  type: ViewType.KANBAN,
  mainGroupByFieldMetadataUniversalIdentifier: SSL.dealStatus,
  position: 1,
  fields: [
    col("81920304-b5c6-4d7e-9f80-1a2b3c4d5e61", SSL.address, 240),
    col("81920304-b5c6-4d7e-9f80-1a2b3c4d5e62", SSL.principal, 130),
    col("81920304-b5c6-4d7e-9f80-1a2b3c4d5e63", SSL.zestimate, 120),
    col("81920304-b5c6-4d7e-9f80-1a2b3c4d5e64", SSL.ownerName, 200),
  ],
});
