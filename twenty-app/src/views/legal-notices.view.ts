// Default index (table) view for Legal Notices.

import { defineView, ViewKey } from "twenty-sdk/define";
import { LEGAL_NOTICE_UID, LN } from "../objects/legal-notice.object";

export const LEGAL_NOTICES_VIEW_UID = "6f708192-a3b4-4c5d-9e6f-7a8b9cadbec0";

let pos = 0;
const col = (uid: string, fieldUid: string, size = 160) => ({
  universalIdentifier: uid,
  fieldMetadataUniversalIdentifier: fieldUid,
  position: pos++,
  isVisible: true,
  size,
});

export default defineView({
  universalIdentifier: LEGAL_NOTICES_VIEW_UID,
  name: "All Legal Notices",
  objectUniversalIdentifier: LEGAL_NOTICE_UID,
  icon: "IconScale",
  key: ViewKey.INDEX,
  position: 0,
  fields: [
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec1", LN.ownerName, 200),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec2", LN.address, 260),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec3", LN.dealStatus, 130),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec4", LN.personalRepresentative, 200),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec5", LN.zestimate, 120),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec6", LN.zillowUrl, 200),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec7", LN.weekDate, 110),
    col("6f708192-a3b4-4c5d-9e6f-7a8b9cadbec8", LN.enrichmentStatus, 110),
  ],
});
