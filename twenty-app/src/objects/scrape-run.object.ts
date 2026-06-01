// Custom object: Scrape Run — one record per scrape execution, for tracking
// (how many listings pulled this month, status, timing). Lets the team see
// "how many sheriff sales we looked at" over time.

import { defineObject, FieldType } from "twenty-sdk/define";

enum RunType {
  SHERIFF = "SHERIFF",
  LEGAL = "LEGAL",
}

enum RunStatus {
  RUNNING = "RUNNING",
  COMPLETE = "COMPLETE",
  FAILED = "FAILED",
}

export const SCRAPE_RUN_UID = "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c01";

export default defineObject({
  universalIdentifier: SCRAPE_RUN_UID,
  nameSingular: "scrapeRun",
  namePlural: "scrapeRuns",
  labelSingular: "Scrape Run",
  labelPlural: "Scrape Runs",
  description: "One sheriff/legal scrape execution, for run tracking and history.",
  icon: "IconHistory",
  fields: [
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c02",
      name: "runType",
      type: FieldType.SELECT,
      label: "Type",
      icon: "IconTag",
      defaultValue: `'${RunType.SHERIFF}'`,
      options: [
        { value: RunType.SHERIFF, label: "Sheriff Sales", position: 0, color: "blue" },
        { value: RunType.LEGAL, label: "Legal Notices", position: 1, color: "green" },
      ],
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c03",
      name: "saleMonth",
      type: FieldType.TEXT,
      label: "Sale Month",
      icon: "IconCalendar",
      isNullable: true,
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c04",
      name: "runStatus",
      type: FieldType.SELECT,
      label: "Status",
      icon: "IconInfoCircle",
      defaultValue: `'${RunStatus.RUNNING}'`,
      options: [
        { value: RunStatus.RUNNING, label: "Running", position: 0, color: "orange" },
        { value: RunStatus.COMPLETE, label: "Complete", position: 1, color: "green" },
        { value: RunStatus.FAILED, label: "Failed", position: 2, color: "red" },
      ],
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c05",
      name: "listingCount",
      type: FieldType.NUMBER,
      label: "Listings",
      icon: "IconList",
      isNullable: true,
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c06",
      name: "enrichedCount",
      type: FieldType.NUMBER,
      label: "Enriched",
      icon: "IconCheck",
      isNullable: true,
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c07",
      name: "startedAt",
      type: FieldType.DATE_TIME,
      label: "Started At",
      icon: "IconClock",
      isNullable: true,
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c08",
      name: "finishedAt",
      type: FieldType.DATE_TIME,
      label: "Finished At",
      icon: "IconClockCheck",
      isNullable: true,
    },
    {
      universalIdentifier: "7b1d9e30-2a4c-4f1b-9c20-3e5f6a7b8c09",
      name: "errorMessage",
      type: FieldType.TEXT,
      label: "Error",
      icon: "IconAlertTriangle",
      isNullable: true,
    },
  ],
});
