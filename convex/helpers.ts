import type { QueryCtx, MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUser } from "./lib/getAuthUser";

/**
 * Require an authenticated, provisioned, active CRM user. Returns the Clerk
 * subject string (callers use it as `triggeredBy`).
 *
 * A real Clerk identity must resolve to an active `users` row, else reject.
 * There is intentionally NO unauthenticated bypass: an env-gated "dev-user"
 * short-circuit was removed because, if that flag were ever set on a
 * deployment, it would let any anonymous caller through (full auth bypass).
 *
 * Only callable from V8 queries/mutations (reads ctx.db). Actions use an
 * internal query (users.getCallerInternal) instead.
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await getAuthUser(ctx);
  if (!user) throw new ConvexError({ code: "NOT_PROVISIONED", message: "Account not provisioned. Contact your administrator." });
  if (!user.isActive) throw new ConvexError({ code: "DEACTIVATED", message: "Account deactivated. Contact your administrator." });
  return identity.subject;
}
