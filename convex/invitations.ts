import { action, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUser } from "./lib/getAuthUser";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

export const invite = action({
  args: { name: v.string(), email: v.string(), role: ROLE },
  handler: async (ctx, args): Promise<{ ok: boolean; invitationId: string }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || me.role !== "admin") throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });

    const email = args.email.trim().toLowerCase();
    const name = args.name.trim();
    if (!email.includes("@")) throw new ConvexError({ code: "BAD_EMAIL", message: "Invalid email" });
    if (!name) throw new ConvexError({ code: "BAD_NAME", message: "Name is required" });

    const existing = await ctx.runQuery(internal.users.getByEmailInternal, { email });
    if (existing) throw new ConvexError({ code: "EXISTS", message: "A user with that email already exists" });

    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!clerkSecret) throw new ConvexError({ code: "NO_CLERK_SECRET", message: "CLERK_SECRET_KEY not configured" });
    const redirect = process.env.CLERK_INVITE_REDIRECT_URL ?? "http://localhost:5173/accept-invite";

    const res = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: email,
        redirect_url: redirect,
        public_metadata: { name, role: args.role, invitedBy: me.email },
        notify: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ConvexError({ code: "CLERK_API_ERROR", message: `Clerk rejected invite (${res.status}): ${text.slice(0, 300)}` });
    }
    const data = (await res.json()) as { id: string };

    try {
      await ctx.runMutation(internal.users.insertProvisionedUser, {
        email, name, role: args.role, invitationId: data.id,
      });
    } catch (insertErr) {
      await fetch(`https://api.clerk.com/v1/invitations/${data.id}/revoke`, {
        method: "POST", headers: { Authorization: `Bearer ${clerkSecret}` },
      }).catch(() => {});
      throw insertErr;
    }
    return { ok: true, invitationId: data.id };
  },
});

export const revoke = action({
  args: { invitationId: v.string() },
  handler: async (ctx, { invitationId }): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || me.role !== "admin") throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });

    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!clerkSecret) throw new ConvexError({ code: "NO_CLERK_SECRET", message: "CLERK_SECRET_KEY not configured" });

    const res = await fetch(`https://api.clerk.com/v1/invitations/${invitationId}/revoke`, {
      method: "POST", headers: { Authorization: `Bearer ${clerkSecret}` },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new ConvexError({ code: "CLERK_API_ERROR", message: `Revoke failed (${res.status}): ${text.slice(0, 300)}` });
    }
    await ctx.runMutation(internal.invitations.deletePendingByInvitationId, { invitationId });
    return { ok: true };
  },
});

import { internalMutation } from "./_generated/server";
export const deletePendingByInvitationId = internalMutation({
  args: { invitationId: v.string() },
  handler: async (ctx, { invitationId }) => {
    const u = await ctx.db
      .query("users")
      .withIndex("by_clerk_invitation", (q) => q.eq("clerkInvitationId", invitationId))
      .first();
    if (u && u.tokenIdentifier.startsWith("pending:")) await ctx.db.delete(u._id);
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    if (!me || me.role !== "admin") return [];
    const all = await ctx.db.query("users").collect();
    return all
      .filter((u) => u.tokenIdentifier.startsWith("pending:"))
      .map((u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, invitationId: u.clerkInvitationId, invitedAt: u.createdAt }));
  },
});
