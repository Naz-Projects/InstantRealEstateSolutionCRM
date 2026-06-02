import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUser } from "./lib/getAuthUser";

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const user = await getAuthUser(ctx);
    if (!user) throw new Error("Account not provisioned. Contact your administrator.");
    if (!user.isActive) throw new Error("Account deactivated. Contact your administrator.");
    return identity.subject;
  }
  if (process.env.IRES_DEV === "1") return "dev-user";
  throw new Error("Not authenticated");
}
