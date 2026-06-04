import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./helpers";
import { getAuthUser, requireAdmin } from "./lib/getAuthUser";

const sourceV = v.union(
  v.literal("boundary"),
  v.literal("handled"),
  v.literal("uncaught"),
  v.literal("server"),
);
const severityV = v.union(v.literal("error"), v.literal("warning"));

// Keep stored strings bounded — a stack trace can be huge.
const cap = (s: string | undefined, n: number) =>
  s == null ? undefined : s.length > n ? s.slice(0, n) : s;

// Best-effort write from the client (ErrorBoundary crashes + page catch-blocks).
// requireUser-gated so only signed-in, provisioned users can write (no anonymous
// spam); the user's email is stamped SERVER-SIDE from the verified identity, never
// trusted from the client. The client calls this fire-and-forget — it must never
// throw back into the UI.
export const logError = mutation({
  args: {
    message: v.string(),
    source: sourceV,
    severity: v.optional(severityV),
    context: v.optional(v.string()),
    route: v.optional(v.string()),
    stack: v.optional(v.string()),
    componentStack: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    const me = await getAuthUser(ctx);
    await ctx.db.insert("errorLogs", {
      message: cap(a.message, 2000) ?? "Unknown error",
      source: a.source,
      severity: a.severity ?? "error",
      context: cap(a.context, 200),
      route: cap(a.route, 300),
      stack: cap(a.stack, 4000),
      componentStack: cap(a.componentStack, 4000),
      userAgent: cap(a.userAgent, 400),
      userEmail: me?.email,
      resolved: false,
      createdAt: Date.now(),
    });
  },
});

// Autonomous backend/cron failures (no UI to surface them). Internal-only.
export const logServerError = internalMutation({
  args: {
    message: v.string(),
    context: v.optional(v.string()),
    stack: v.optional(v.string()),
    severity: v.optional(severityV),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("errorLogs", {
      message: cap(a.message, 2000) ?? "Unknown error",
      source: "server",
      severity: a.severity ?? "error",
      context: cap(a.context, 200),
      stack: cap(a.stack, 4000),
      resolved: false,
      createdAt: Date.now(),
    });
  },
});

// Admin-only: recent errors for the Admin → Error Log page (newest first).
export const listErrors = query({
  args: { onlyUnresolved: v.optional(v.boolean()) },
  handler: async (ctx, { onlyUnresolved }) => {
    const me = await getAuthUser(ctx);
    if (!me || !me.isActive || me.role !== "admin") return [];
    if (onlyUnresolved) {
      return ctx.db
        .query("errorLogs")
        .withIndex("by_resolved", (q) => q.eq("resolved", false))
        .order("desc")
        .take(200);
    }
    return ctx.db.query("errorLogs").order("desc").take(200);
  },
});

// Admin-only: unresolved count for the sidebar badge (0 for non-admins).
export const unresolvedCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    if (!me || !me.isActive || me.role !== "admin") return 0;
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .collect();
    return rows.length;
  },
});

// Admin-only: mark one error resolved / reopened.
export const setResolved = mutation({
  args: { id: v.id("errorLogs"), resolved: v.boolean() },
  handler: async (ctx, { id, resolved }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, { resolved });
  },
});

// Admin-only: clear all resolved errors.
export const clearResolved = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_resolved", (q) => q.eq("resolved", true))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});
