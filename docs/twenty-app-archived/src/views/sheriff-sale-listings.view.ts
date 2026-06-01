// Default index (table) view for Sheriff Sale Listings — the columns a
// wholesaler cares about, in a useful order. A Kanban "pipeline" view grouped
// by Deal Status can be created in one click in the UI, or added here via
// `groups` once validated against the running server.

import { defineView, ViewKey } from "twenty-sdk/define";
import { SHERIFF_SALE_LISTING_UID, SSL } from "../objects/sheriff-sale-listing.object";

export const SHERIFF_SALE_LISTINGS_VIEW_UID = "3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e10";

let pos = 0;
const col = (uid: string, fieldUid: string, size = 160) => ({
  universalIdentifier: uid,
  fieldMetadataUniversalIdentifier: fieldUid,
  position: pos++,
  isVisible: true,
  size,
});

export default defineView({
  universalIdentifier: SHERIFF_SALE_LISTINGS_VIEW_UID,
  name: "All Sheriff Sales",
  objectUniversalIdentifier: SHERIFF_SALE_LISTING_UID,
  icon: "IconGavel",
  key: ViewKey.INDEX,
  position: 0,
  fields: [
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e11", SSL.address, 240),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e12", SSL.saleType, 90),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e13", SSL.dealStatus, 130),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e14", SSL.principal, 130),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e15", SSL.ownerName, 200),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e16", SSL.assessmentTotal, 130),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e17", SSL.zestimate, 120),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e18", SSL.countyBalanceDue, 120),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e19", SSL.zillowUrl, 200),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e1a", SSL.enrichmentStatus, 110),
    col("3d5e7a90-4b6c-4d2e-9f01-5a6b7c8d9e1b", SSL.parcel, 130),
  ],
});
