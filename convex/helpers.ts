import type { QueryCtx, MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUser } from "./lib/getAuthUser";

/**
 * Require an authenticated, provisioned, active CRM user. Returns the Clerk
 * subject string (callers use it as `triggeredBy`).
 *
 * - Real Clerk identity: must resolve to an active `users` row, else reject.
 * - Dev bypass (IRES_DEV=1, no identity): returns "dev-user" unchanged, so dev
 *   flows keep working until IRES_DEV is dropped.
 *
 * Only callable from V8 queries/mutations (reads ctx.db). Actions use an
 * internal query (users.getCallerInternal) instead.
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const user = await getAuthUser(ctx);
    if (!user) throw new ConvexError({ code: "NOT_PROVISIONED", message: "Account not provisioned. Contact your administrator." });
    if (!user.isActive) throw new ConvexError({ code: "DEACTIVATED", message: "Account deactivated. Contact your administrator." });
    return identity.subject;
  }
  if (process.env.IRES_DEV === "1") return "dev-user";
  throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
}
