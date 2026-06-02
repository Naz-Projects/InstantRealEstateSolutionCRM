import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// The owner — seeded as the first admin so the very first real sign-in links to an admin row.
export const OWNER_EMAIL = "nazhossain16@gmail.com";

type Ctx = QueryCtx | MutationCtx;

export async function getAuthUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const byToken = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
    .unique();
  if (byToken) return byToken;

  if (identity.email) {
    const email = String(identity.email).toLowerCase();
    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (byEmail) return byEmail;
  }
  return null;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (!user.isActive) throw new Error("Account deactivated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user;
}
