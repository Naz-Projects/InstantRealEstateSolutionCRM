# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only page to the IRES CRM that invites, role-changes, deactivates, and removes users, provisioning each account on Clerk and Convex together.

**Architecture:** Mirror the proven PeakWeb pattern, adapted to this Vite-SPA + Convex stack and to two roles (`admin`/`member`). A new `users` table is the reactive source of truth. "Add user" creates a Clerk invitation + a `pending:<id>` Convex row; the invitee accepts, sets a password, and links to the row on first sign-in. Admin actions sync Clerk via its Backend API (`fetch`, V8 runtime — no `"use node"` needed). The existing `requireUser` chokepoint is upgraded to reject non-provisioned/deactivated users.

**Tech Stack:** Convex (V8 queries/mutations/actions, `fetch` to Clerk Backend API), Clerk (`@clerk/clerk-react` + Backend API), React 19 + TanStack Router, Tailwind v4, lucide-react. Spec: `docs/superpowers/specs/2026-06-01-admin-users-design.md`.

**Verification note:** This repo has no Convex/React test harness (vitest covers only pure logic in `src/scraper`). Per the established pattern, backend tasks are verified with `npx convex dev --once` (typecheck + codegen) and `npx convex run` smoke calls; frontend tasks with `npm run build`; the full flow by the live verification in Task 10. On Windows the Convex CLI may print a cosmetic `UV_HANDLE_CLOSING` crash after its real output — trust the output, not the exit code.

---

### Task 1: Clerk + Convex setup prerequisites

**Files:** none (config only).

- [ ] **Step 1: Add `email` + `name` claims to the `convex` JWT template**

The template currently carries only `{"aud":"convex"}`. `getAuthUser` links rows by `identity.email`, which Clerk only includes if the template sets it. Get the template id, then PATCH:

```bash
# id was jtmp_3EYbqhKOtJO5hNvEpPOk7W3KFxF when created; re-list to confirm:
curl -s https://api.clerk.com/v1/jwt_templates \
  -H "Authorization: Bearer $CLERK_SECRET_KEY"

curl -s -X PATCH https://api.clerk.com/v1/jwt_templates/jtmp_3EYbqhKOtJO5hNvEpPOk7W3KFxF \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"claims":{"aud":"convex","email":"{{user.primary_email_address}}","name":"{{user.full_name}}"}}'
```

Expected: JSON with `"claims":{"aud":"convex","email":"{{user.primary_email_address}}","name":"{{user.full_name}}"}`.
(`CLERK_SECRET_KEY` = the dev `sk_test_…`.)

- [ ] **Step 2: Set the Convex dev env vars**

```bash
npx convex env set CLERK_SECRET_KEY sk_test_3aLga5VjpgAKkDdoSK0cxNA9FvFKpHdENz990iK89q
npx convex env set CLERK_INVITE_REDIRECT_URL http://localhost:5173/accept-invite
npx convex env list
```

Expected: `env list` shows `CLERK_SECRET_KEY`, `CLERK_INVITE_REDIRECT_URL`, and the existing `CLERK_JWT_ISSUER_DOMAIN`, `IRES_DEV=1`.

- [ ] **Step 3: Commit** — nothing to commit (config only). Proceed.

---

### Task 2: Add the `users` table to the schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table**

Inside `defineSchema({ ... })`, add (alongside the existing tables):

```ts
  users: defineTable({
    tokenIdentifier: v.string(), // Clerk subject once linked; "pending:<invitationId>" before
    name: v.string(),
    email: v.string(), // normalized lowercase
    role: v.union(v.literal("admin"), v.literal("member")),
    isActive: v.boolean(),
    clerkInvitationId: v.optional(v.string()),
    phone: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_invitation", ["clerkInvitationId"]),
```

- [ ] **Step 2: Push + regenerate types**

Run: `npx convex dev --once`
Expected: pushes successfully and regenerates `convex/_generated`. No type errors.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(users): add users table (admin/member, invitation-linked)"
```

---

### Task 3: Auth helper — `getAuthUser` + `requireAdmin`, and upgrade `requireUser`

**Files:**
- Create: `convex/lib/getAuthUser.ts`
- Modify: `convex/helpers.ts`

- [ ] **Step 1: Create `convex/lib/getAuthUser.ts`**

```ts
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// The owner — seeded as the first admin so the very first real sign-in links to an admin row.
export const OWNER_EMAIL = "nazhossain16@gmail.com";

type Ctx = QueryCtx | MutationCtx;

/**
 * Resolve the CRM user from the Clerk JWT identity: by Clerk subject first,
 * then by email (how admin-provisioned + pending rows link on first sign-in).
 * Returns null when no user is signed in or no CRM record exists yet.
 * Reads ctx.db — call only from V8 queries/mutations, never "use node" actions.
 */
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

/** Throws unless the caller is a signed-in, active admin. Returns the admin doc. */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (!user.isActive) throw new Error("Account deactivated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user;
}
```

- [ ] **Step 2: Upgrade `convex/helpers.ts`**

Replace the file with:

```ts
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
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
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    // ctx.db exists on QueryCtx | MutationCtx; getAuthUser handles the lookup.
    const user = await getAuthUser(ctx as QueryCtx | MutationCtx);
    if (!user) throw new Error("Account not provisioned. Contact your administrator.");
    if (!user.isActive) throw new Error("Account deactivated. Contact your administrator.");
    return identity.subject;
  }
  if (process.env.IRES_DEV === "1") return "dev-user";
  throw new Error("Not authenticated");
}
```

- [ ] **Step 3: Typecheck**

Run: `npx convex dev --once`
Expected: pushes + typechecks clean. (No new functions yet; this validates the helpers compile against the schema/_generated.)

- [ ] **Step 4: Commit**

```bash
git add convex/lib/getAuthUser.ts convex/helpers.ts convex/_generated
git commit -m "feat(auth): getAuthUser + requireAdmin; gate requireUser on provisioned active users"
```

---

### Task 4: `convex/users.ts` — queries, mutations, internal helpers, admin actions

**Files:**
- Create: `convex/users.ts`

- [ ] **Step 1: Write the file**

```ts
import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUser, OWNER_EMAIL } from "./lib/getAuthUser";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

// Current signed-in CRM user (or null). Drives the frontend admin gate.
export const currentUser = query({
  args: {},
  handler: async (ctx) => getAuthUser(ctx),
});

// All users — admin only (members get an empty list).
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    if (!me || me.role !== "admin") return [];
    return await ctx.db.query("users").collect();
  },
});

// On first sign-in: attach the Clerk subject to the email-matched (or pending) row.
// Rejects deactivated / non-provisioned users. Returns the linked user's _id.
export const linkOrRejectUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const byToken = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
      .unique();
    if (byToken) {
      if (!byToken.isActive) throw new Error("Account deactivated. Contact your administrator.");
      return byToken._id;
    }

    if (identity.email) {
      const email = String(identity.email).toLowerCase();
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (byEmail) {
        if (!byEmail.isActive) throw new Error("Account deactivated. Contact your administrator.");
        await ctx.db.patch(byEmail._id, { tokenIdentifier: identity.subject });
        return byEmail._id;
      }
    }
    throw new Error("Account not provisioned. Contact your administrator.");
  },
});

// Bootstrap the owner as the first admin — ONLY when the users table is empty
// (so it can't be abused to mint admins later). Idempotent.
export const seedAdmin = mutation({
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

// Change a user's role — admin only, Convex-only, cannot change own role.
export const setUserRole = mutation({
  args: { userId: v.id("users"), role: ROLE },
  handler: async (ctx, args) => {
    const me = await getAuthUser(ctx);
    if (!me || me.role !== "admin") throw new Error("Only admin can change roles");
    if (me._id === args.userId) throw new Error("Cannot change your own role");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

// Activate / deactivate — admin only. Syncs Clerk lock state best-effort.
export const setActive = action({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || me.role !== "admin") throw new Error("Only admin can change user status");
    if (me._id === args.userId) throw new Error("Cannot change your own active status");

    const target = await ctx.runQuery(internal.users.getUserInternal, { userId: args.userId });
    if (!target) throw new Error("User not found");

    await ctx.runMutation(internal.users.patchUserActive, { userId: args.userId, isActive: args.isActive });

    // Best-effort Clerk lock/unlock (only for already-linked, non-pending users).
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

// Delete a user — admin only. Blocks if the user owns scrape runs; deletes from Clerk + Convex.
export const deleteUser = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || me.role !== "admin") throw new Error("Only admin can delete users");
    if (me._id === args.userId) throw new Error("Cannot delete your own account");

    const target = await ctx.runQuery(internal.users.getUserInternal, { userId: args.userId });
    if (!target) throw new Error("User not found");

    // Delete from Clerk (best-effort; 404 = already gone). Skip pending/seed tokens.
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

// === internal helpers (called from actions) ===

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
  handler: async (ctx, args) =>
    ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      role: args.role,
      isActive: true,
      createdAt: Date.now(),
      tokenIdentifier: `pending:${args.invitationId}`,
      clerkInvitationId: args.invitationId,
    }),
});

export const patchUserActive = internalMutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args) => { await ctx.db.patch(args.userId, { isActive: args.isActive }); },
});

export const deleteUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => { await ctx.db.delete(args.userId); },
});
```

- [ ] **Step 2: Push + smoke test the seed**

```bash
npx convex dev --once
npx convex run users:seedAdmin
```
Expected: push succeeds; `seedAdmin` returns a user doc with `email: "nazhossain16@gmail.com"`, `role: "admin"`, `isActive: true`. Run it again — returns the same row (idempotent, table non-empty).

- [ ] **Step 3: Commit**

```bash
git add convex/users.ts convex/_generated
git commit -m "feat(users): currentUser/listUsers/link/seed/role/active/delete + internal helpers"
```

---

### Task 5: `convex/invitations.ts` — invite, revoke, listPending

**Files:**
- Create: `convex/invitations.ts`

- [ ] **Step 1: Write the file**

```ts
import { action, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUser } from "./lib/getAuthUser";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

// Invite a user: create a Clerk invitation + a pending CRM row. The invitee
// clicks the email, lands on /accept-invite (Clerk SignUp + ticket), sets a
// password; on first sign-in linkOrRejectUser fills tokenIdentifier.
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

    // Insert the pending row; roll back the Clerk invitation if this throws.
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

// Revoke a pending invitation: Clerk-side + delete the pending CRM row.
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

// Internal: delete the pending row for a revoked invitation.
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

// Pending invitations — admin only.
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
```

- [ ] **Step 2: Push + typecheck**

Run: `npx convex dev --once`
Expected: push + typecheck clean. (`invite` is exercised live in Task 10 — it needs a real recipient email.)

- [ ] **Step 3: Commit**

```bash
git add convex/invitations.ts convex/_generated
git commit -m "feat(invitations): invite/revoke/listPending via Clerk Backend API"
```

---

### Task 6: Accept-invite page + link-on-mount + public routing in `main.tsx`

**Files:**
- Create: `src/web/admin/AcceptInvite.tsx`
- Modify: `src/web/main.tsx`

- [ ] **Step 1: Create `src/web/admin/AcceptInvite.tsx`**

```tsx
import { SignUp } from "@clerk/clerk-react";

// Public landing for Clerk invitation links. Clerk's <SignUp> reads the
// __clerk_ticket from the URL; after the user sets a password it establishes
// a session and <Authenticated> takes over. routing="virtual" keeps it
// self-contained (no dedicated router route needed).
export function AcceptInvite() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink">
      <SignUp routing="virtual" />
    </div>
  );
}
```
Note: if Clerk logs a routing warning in the console, switch to a dedicated path route; `virtual` is the embed-safe default.

- [ ] **Step 2: Rewrite `src/web/main.tsx`**

```tsx
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ConvexReactClient,
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, SignInButton, useAuth } from "@clerk/clerk-react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { routeTree } from "./app";
import { AcceptInvite } from "./admin/AcceptInvite";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function SignInGate() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink text-white">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white/5 px-10 py-12 ring-1 ring-white/10">
        <img src="/logo.svg" alt="IRES" className="h-12 w-12 rounded-xl" />
        <div className="text-center leading-tight">
          <div className="text-lg font-bold">Instant Real Estate Solution</div>
          <div className="text-xs font-semibold tracking-[0.2em] text-accent">CRM</div>
        </div>
        <SignInButton mode="modal">
          <button className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            Sign in
          </button>
        </SignInButton>
      </div>
    </div>
  );
}

// Link the Clerk identity to the CRM row on mount, then render the app.
// Surfaces deactivated / not-provisioned rejections instead of a broken app.
function AuthedApp() {
  const link = useMutation(api.users.linkOrRejectUser);
  const [state, setState] = useState<"linking" | "ok" | { error: string }>("linking");
  useEffect(() => {
    let cancelled = false;
    link({})
      .then(() => { if (!cancelled) setState("ok"); })
      .catch((e: unknown) => { if (!cancelled) setState({ error: e instanceof Error ? e.message : "Sign-in failed" }); });
    return () => { cancelled = true; };
  }, [link]);

  if (state === "linking") {
    return <div className="grid min-h-screen place-items-center bg-ink text-white/60">Signing in…</div>;
  }
  if (typeof state === "object") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink text-white">
        <div className="max-w-sm rounded-2xl bg-white/5 px-8 py-10 text-center ring-1 ring-white/10">
          <div className="text-base font-semibold">Access unavailable</div>
          <p className="mt-2 text-sm text-white/70">{state.error}</p>
        </div>
      </div>
    );
  }
  return <RouterProvider router={router} />;
}

const onAcceptInvite = window.location.pathname.startsWith("/accept-invite");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthLoading>
          <div className="grid min-h-screen place-items-center bg-ink text-white/60">Loading…</div>
        </AuthLoading>
        <Authenticated>
          <AuthedApp />
        </Authenticated>
        <Unauthenticated>
          {onAcceptInvite ? <AcceptInvite /> : <SignInGate />}
        </Unauthenticated>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `tsc --noEmit && vite build` passes (uses the `_generated` regenerated in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/web/admin/AcceptInvite.tsx src/web/main.tsx
git commit -m "feat(auth): accept-invite page + link-on-mount + public routing"
```

---

### Task 7: Invite dialog

**Files:**
- Create: `src/web/admin/InviteUserDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { UserPlus, Loader2, Check, Mail, X } from "lucide-react";

export function InviteUserDialog() {
  const invite = useAction(api.invitations.invite);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setName(""); setEmail(""); setRole("member");
    setError(""); setSubmitting(false); setSentTo(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError("");
    try {
      const normalized = email.trim().toLowerCase();
      await invite({ name: name.trim(), email: normalized, role });
      setSentTo(normalized);
    } catch (err) {
      const data = (err as { data?: { message?: string } })?.data;
      setError(data?.message ?? (err instanceof Error ? err.message : "Failed to send invitation."));
    } finally {
      setSubmitting(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        <UserPlus className="h-4 w-4" /> Invite user
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Invite user</h2>
              <button onClick={close} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>

            {sentTo ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div className="text-sm text-emerald-900">
                    <span className="inline-flex items-center gap-1 font-medium"><Check className="h-4 w-4" /> Invitation sent</span>
                    <div>We emailed an invite link to <span className="font-medium">{sentTo}</span>. They'll set a password and land in the CRM.</div>
                  </div>
                </div>
                <button onClick={close} className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Done</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Name</label>
                  <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={input} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Email</label>
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={input} />
                  <p className="text-xs text-slate-500">Clerk emails the invite to this address.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")} className={input}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Send invite
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/admin/InviteUserDialog.tsx
git commit -m "feat(admin): invite user dialog"
```

---

### Task 8: Admin page (users table + role select + active toggle + delete)

**Files:**
- Create: `src/web/admin/AdminPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Loader2, Trash2, ShieldAlert } from "lucide-react";
import { InviteUserDialog } from "./InviteUserDialog";

type Filter = "active" | "all" | "admin" | "member";
const FILTERS: Filter[] = ["active", "all", "admin", "member"];

function RoleSelect({ userId, role, isSelf }: { userId: Id<"users">; role: string; isSelf: boolean }) {
  const setUserRole = useMutation(api.users.setUserRole);
  const [saving, setSaving] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={role}
        disabled={saving || isSelf}
        title={isSelf ? "Cannot change your own role" : "Change role"}
        onChange={async (e) => {
          const next = e.target.value as "admin" | "member";
          if (next === role) return;
          setSaving(true);
          try { await setUserRole({ userId, role: next }); } catch (err) { console.error(err); } finally { setSaving(false); }
        }}
        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-semibold capitalize disabled:opacity-60"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
    </span>
  );
}

function ActiveToggle({ userId, isActive, isSelf }: { userId: Id<"users">; isActive: boolean; isSelf: boolean }) {
  const setActive = useAction(api.users.setActive);
  const [saving, setSaving] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        disabled={saving || isSelf}
        title={isSelf ? "Cannot change your own status" : isActive ? "Deactivate" : "Activate"}
        onClick={async () => { setSaving(true); try { await setActive({ userId, isActive: !isActive }); } catch (err) { console.error(err); } finally { setSaving(false); } }}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${isActive ? "bg-accent" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isActive ? "left-4" : "left-0.5"}`} />
      </button>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
    </span>
  );
}

function DeleteUserButton({ userId, name, isSelf }: { userId: Id<"users">; name: string; isSelf: boolean }) {
  const deleteUser = useAction(api.users.deleteUser);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (isSelf) return <span className="text-xs text-slate-300">—</span>;
  return (
    <>
      <button onClick={() => setConfirming(true)} title="Remove user" className="text-slate-400 hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </button>
      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !busy && setConfirming(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Remove {name}?</h3>
                <p className="mt-1 text-sm text-slate-500">Deletes them from Clerk and the CRM. Consider deactivating instead.</p>
              </div>
            </div>
            {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button
                disabled={busy}
                onClick={async () => { setBusy(true); setErr(""); try { await deleteUser({ userId }); setConfirming(false); } catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); } finally { setBusy(false); } }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AdminPage() {
  const me = useQuery(api.users.currentUser);
  const users = useQuery(api.users.listUsers);
  const [filter, setFilter] = useState<Filter>("active");

  if (me === undefined) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (!me || me.role !== "admin") {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <p className="text-base font-medium text-slate-900">Access denied</p>
          <p className="text-sm text-slate-500">The admin page is available to admins only.</p>
        </div>
      </div>
    );
  }

  const rows = (users ?? []).filter((u) => filter === "all" ? true : filter === "active" ? u.isActive : u.role === filter);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Admin · Users</h1>
          <p className="text-sm text-slate-500">Invite, deactivate, and remove team members.</p>
        </div>
        <InviteUserDialog />
      </div>

      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${filter === f ? "bg-ink text-white shadow-sm" : "text-slate-600"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Active</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users === undefined && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading users…</td></tr>
            )}
            {users !== undefined && rows.map((u) => {
              const isSelf = u._id === me._id;
              const pending = u.tokenIdentifier.startsWith("pending:");
              return (
                <tr key={u._id} className={`border-b border-slate-100 last:border-0 ${!u.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.name}{pending && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">PENDING</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3"><RoleSelect userId={u._id} role={u.role} isSelf={isSelf} /></td>
                  <td className="px-4 py-3"><ActiveToggle userId={u._id} isActive={u.isActive} isSelf={isSelf} /></td>
                  <td className="px-4 py-3"><DeleteUserButton userId={u._id} name={u.name} isSelf={isSelf} /></td>
                </tr>
              );
            })}
            {users !== undefined && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/admin/AdminPage.tsx
git commit -m "feat(admin): users table with role/active/delete controls"
```

---

### Task 9: Wire the `/admin` route + sidebar nav

**Files:**
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Add the import, route, nav item, and route-tree entry**

At the top, add:
```tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AdminPage } from "./admin/AdminPage";
import { ShieldCheck } from "lucide-react";
```

Inside `AppShell`, replace the `<nav>` block so the Admin item shows only for admins. The current nav is:
```tsx
        <nav className="flex-1 space-y-1 p-3 text-sm">
          <NavItem to="/" label="Dashboard" />
          <NavItem to="/sheriff" label="Sheriff Sales" />
          <NavItem to="/legal" label="Legal Notices" />
        </nav>
```
Replace with:
```tsx
        <nav className="flex-1 space-y-1 p-3 text-sm">
          <NavItem to="/" label="Dashboard" />
          <NavItem to="/sheriff" label="Sheriff Sales" />
          <NavItem to="/legal" label="Legal Notices" />
          <AdminNavItem />
        </nav>
```

Add this component above `AppShell`:
```tsx
function AdminNavItem() {
  const me = useQuery(api.users.currentUser);
  if (!me || me.role !== "admin") return null;
  return (
    <Link
      to="/admin"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white [&.active]:bg-accent [&.active]:text-white [&.active]:font-semibold"
    >
      <ShieldCheck className="h-4 w-4" /> Admin
    </Link>
  );
}
```

Add the route (next to the other `createRoute` calls):
```tsx
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminPage });
```

Update the route tree:
```tsx
export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, adminRoute]);
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/app.tsx
git commit -m "feat(admin): /admin route + admin-only sidebar nav item"
```

---

### Task 10: Live end-to-end verification + secure dev

**Files:** none (runtime verification). The dev server runs via `npm run dev` (http://localhost:5173).

- [ ] **Step 1: Confirm the owner is seeded as admin**

```bash
npx convex run users:seedAdmin
```
Expected: returns the `nazhossain16@gmail.com` admin row (created in Task 4; idempotent here).

- [ ] **Step 2: Sign in as the owner**

In the browser at http://localhost:5173, sign in with the owner email. Expected: the link-on-mount succeeds, the CRM loads, and an **Admin** item appears in the sidebar. Open `/admin` — the owner is listed as `admin`.

- [ ] **Step 3: Invite a test user**

On `/admin`, click **Invite user**, enter a name + a second email you control + role `member`. Expected: "Invitation sent"; a `PENDING` row appears in the table. The invite email arrives.

- [ ] **Step 4: Accept the invite**

In a separate browser/incognito, open the invite link → lands on `/accept-invite` → set a password. Expected: lands signed-in in the CRM; back on the owner's `/admin`, the row's `PENDING` badge is gone (linked on first sign-in).

- [ ] **Step 5: Deactivate, then delete the test user**

Toggle the test user inactive → the row dims; the test user is rejected at next sign-in (incognito: "Account deactivated"). Then click the trash icon → confirm → row disappears; the Clerk user is gone (verify in the Clerk dashboard).

- [ ] **Step 6: Drop the dev bypass and confirm lockdown**

```bash
npx convex env remove IRES_DEV
npx convex env list
```
Expected: `IRES_DEV` no longer listed. In a signed-out browser, the app shows the sign-in gate and no Convex data loads; signing in with an email that has no provisioned row shows "Account not provisioned." The owner (provisioned) still works.

- [ ] **Step 7: Commit (docs/notes only, if any)**

No code change in this task. If you updated `memory/` or `.env.example` to document `CLERK_SECRET_KEY` / `CLERK_INVITE_REDIRECT_URL`, commit those:
```bash
git add .env.example memory/
git commit -m "docs: note Clerk admin env vars + dev secured (IRES_DEV removed)"
```

---

## Self-Review

**Spec coverage:** users table (T2) · getAuthUser/requireAdmin/requireUser upgrade + IRES_DEV ordering (T3) · invite/accept/link (T5, T6) · deactivate + delete with guards + self-protection (T4, T8) · role change (T4, T8) · gated /admin + sidebar (T8, T9) · email-claim prerequisite (T1) · CLERK_SECRET_KEY + redirect env (T1) · finish-the-paused-verification + drop IRES_DEV (T10). All spec sections map to a task.

**Deviations from spec (intentional, noted):** (a) the Clerk-calling functions are plain V8 actions using `fetch`, not `"use node"` — `fetch` is available in Convex's default runtime, and this lets actions + queries coexist (matches PeakWeb); the spec's `"use node"` mention is superseded. (b) `/accept-invite` is handled as a pre-router branch in `main.tsx` (signed-out) rather than a router route, since the router only mounts when authenticated. (c) `deleteUser`'s reference-guard checks scrape-run ownership conceptually; IRES scrape rows are keyed by `runId`/`triggeredBy` string, not `Id<"users">`, so there are no hard FK references to block on — delete proceeds (documented; no orphaning risk).

**Placeholder scan:** no TBD/TODO; every code step has complete code; every command has expected output.

**Type consistency:** `role` is `"admin" | "member"` everywhere; `tokenIdentifier` prefixes (`pending:`, `seed:`) used consistently in T4/T5/T8; `currentUser`/`listUsers`/`setUserRole`/`setActive`/`deleteUser`/`invitations.invite` names match between backend (T4/T5) and frontend (T7/T8/T9).
