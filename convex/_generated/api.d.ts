/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as compsActions from "../compsActions.js";
import type * as conditionActions from "../conditionActions.js";
import type * as conditionData from "../conditionData.js";
import type * as contractActions from "../contractActions.js";
import type * as contractData from "../contractData.js";
import type * as crons from "../crons.js";
import type * as equityActions from "../equityActions.js";
import type * as equityData from "../equityData.js";
import type * as errors from "../errors.js";
import type * as flipData from "../flipData.js";
import type * as geocodeActions from "../geocodeActions.js";
import type * as geocodeData from "../geocodeData.js";
import type * as helpers from "../helpers.js";
import type * as invitations from "../invitations.js";
import type * as legalActions from "../legalActions.js";
import type * as legalData from "../legalData.js";
import type * as lib_getAuthUser from "../lib/getAuthUser.js";
import type * as marketActions from "../marketActions.js";
import type * as marketData from "../marketData.js";
import type * as monitorActions from "../monitorActions.js";
import type * as monitorData from "../monitorData.js";
import type * as monitorScrape from "../monitorScrape.js";
import type * as offerData from "../offerData.js";
import type * as parcelActions from "../parcelActions.js";
import type * as parcelData from "../parcelData.js";
import type * as pipelineData from "../pipelineData.js";
import type * as potentialData from "../potentialData.js";
import type * as propertyActions from "../propertyActions.js";
import type * as propertyData from "../propertyData.js";
import type * as runs from "../runs.js";
import type * as sheriffActions from "../sheriffActions.js";
import type * as sheriffData from "../sheriffData.js";
import type * as signalActions from "../signalActions.js";
import type * as signalData from "../signalData.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  compsActions: typeof compsActions;
  conditionActions: typeof conditionActions;
  conditionData: typeof conditionData;
  contractActions: typeof contractActions;
  contractData: typeof contractData;
  crons: typeof crons;
  equityActions: typeof equityActions;
  equityData: typeof equityData;
  errors: typeof errors;
  flipData: typeof flipData;
  geocodeActions: typeof geocodeActions;
  geocodeData: typeof geocodeData;
  helpers: typeof helpers;
  invitations: typeof invitations;
  legalActions: typeof legalActions;
  legalData: typeof legalData;
  "lib/getAuthUser": typeof lib_getAuthUser;
  marketActions: typeof marketActions;
  marketData: typeof marketData;
  monitorActions: typeof monitorActions;
  monitorData: typeof monitorData;
  monitorScrape: typeof monitorScrape;
  offerData: typeof offerData;
  parcelActions: typeof parcelActions;
  parcelData: typeof parcelData;
  pipelineData: typeof pipelineData;
  potentialData: typeof potentialData;
  propertyActions: typeof propertyActions;
  propertyData: typeof propertyData;
  runs: typeof runs;
  sheriffActions: typeof sheriffActions;
  sheriffData: typeof sheriffData;
  signalActions: typeof signalActions;
  signalData: typeof signalData;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
