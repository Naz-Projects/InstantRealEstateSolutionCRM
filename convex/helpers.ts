import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";

/**
 * Require an authenticated Clerk user. In local dev (no Clerk configured yet),
 * set the Convex env var IRES_DEV=1 to allow anonymous access for testing.
 * In production (IRES_DEV unset) real auth is enforced.
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) return identity.subject;
  if (process.env.IRES_DEV === "1") return "dev-user";
  throw new Error("Not authenticated");
}
