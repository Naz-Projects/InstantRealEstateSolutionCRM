import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUser, requireAdmin, OWNER_EMAIL } from "./lib/getAuthUser";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

export const currentUser = query({
  args: {},
  handler: async (ctx) => getAuthUser(ctx),
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    if (!me || !me.isActive || me.role !== "admin") return [];
    return await ctx.db.query("users").collect();
  },
});

export const linkOrRejectUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const byToken = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
      .unique();
    if (byToken) {
      if (!byToken.isActive) throw new ConvexError({ code: "DEACTIVATED", message: "Account deactivated. Contact your administrator." });
      return byToken._id;
    }

    if (identity.email) {
      const email = String(identity.email).toLowerCase();
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (byEmail) {
        if (!byEmail.isActive) throw new ConvexError({ code: "DEACTIVATED", message: "Account deactivated. Contact your administrator." });
        await ctx.db.patch(byEmail._id, { tokenIdentifier: identity.subject });
        return byEmail._id;
      }
    }
    throw new ConvexError({ code: "NOT_PROVISIONED", message: "Account not provisioned. Contact your administrator." });
  },
});

// Bootstrap the owner as the first admin — ONLY when the users table is empty
// (so it can't be abused to mint admins later). Idempotent. Internal: invoke
// once via `npx convex run users:seedAdmin`; never exposed to the browser.
export const seedAdmin = internalMutation({
  args: {},
  handler: async (ctx) => {
    const any = await ctx.db.query("users").first();
    if (any) return any;
    const id = await ctx.db.insert("users", {
      tokenIdentifier: `seed:${OWNER_EMAIL}`,
      name: "Naz Hossain",
      email: OWNER_EMAIL,
      role: "admin" as const,
      isActive: true,
      createdAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  },
});

export const setUserRole = mutation({
  args: { userId: v.id("users"), role: ROLE },
  handler: async (ctx, args) => {
    const me = await requireAdmin(ctx);
    if (me._id === args.userId) throw new ConvexError({ code: "SELF_TARGET", message: "Cannot change your own role" });
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

export const setActive = action({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || !me.isActive || me.role !== "admin") throw new ConvexError({ code: "FORBIDDEN", message: "Only admin can change user status" });
    if (me._id === args.userId) throw new ConvexError({ code: "SELF_TARGET", message: "Cannot change your own active status" });

    const target = await ctx.runQuery(internal.users.getUserInternal, { userId: args.userId });
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    await ctx.runMutation(internal.users.patchUserActive, { userId: args.userId, isActive: args.isActive });

    if (target.tokenIdentifier && !target.tokenIdentifier.startsWith("pending:") && !target.tokenIdentifier.startsWith("seed:")) {
      const clerkSecret = process.env.CLERK_SECRET_KEY;
      if (clerkSecret) {
        const clerkUserId = target.tokenIdentifier.includes("|")
          ? target.tokenIdentifier.split("|").pop()!
          : target.tokenIdentifier;
        const endpoint = args.isActive ? "unlock" : "lock";
        const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
        if (!res.ok) console.error("Clerk lock sync failed:", await res.text().catch(() => ""));
      }
    }
    return { ok: true };
  },
});

export const deleteUser = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || !me.isActive || me.role !== "admin") throw new ConvexError({ code: "FORBIDDEN", message: "Only admin can delete users" });
    if (me._id === args.userId) throw new ConvexError({ code: "SELF_TARGET", message: "Cannot delete your own account" });

    const target = await ctx.runQuery(internal.users.getUserInternal, { userId: args.userId });
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    if (target.tokenIdentifier && !target.tokenIdentifier.startsWith("pending:") && !target.tokenIdentifier.startsWith("seed:")) {
      const clerkSecret = process.env.CLERK_SECRET_KEY;
      if (clerkSecret) {
        const clerkUserId = target.tokenIdentifier.includes("|")
          ? target.tokenIdentifier.split("|").pop()!
          : target.tokenIdentifier;
        const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
        if (!res.ok && res.status !== 404) console.error("Clerk delete failed:", await res.text().catch(() => ""));
      }
    }

    await ctx.runMutation(internal.users.deleteUserInternal, { userId: args.userId });
    return { ok: true };
  },
});

export const getCallerInternal = internalQuery({
  args: {},
  handler: async (ctx) => getAuthUser(ctx),
});

export const getUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
});

export const getByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", args.email)).unique(),
});

export const insertProvisionedUser = internalMutation({
  args: { email: v.string(), name: v.string(), role: ROLE, invitationId: v.string() },
  handler: async (ctx, args) => {
    // Re-check uniqueness inside the transaction to close the invite TOCTOU window —
    // two duplicate-email rows would make getAuthUser's `.unique()` throw permanently.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) throw new ConvexError({ code: "EXISTS", message: "A user with that email already exists" });
    return ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      role: args.role,
      isActive: true,
      createdAt: Date.now(),
      tokenIdentifier: `pending:${args.invitationId}`,
      clerkInvitationId: args.invitationId,
    });
  },
});

export const patchUserActive = internalMutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args) => { await ctx.db.patch(args.userId, { isActive: args.isActive }); },
});

export const deleteUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => { await ctx.db.delete(args.userId); },
});
