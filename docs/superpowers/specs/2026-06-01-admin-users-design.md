# Admin User Management — Design (v1)

Date: 2026-06-01
Status: awaiting user approval

## Goal

An admin-only page in the IRES CRM to **invite, role-change, deactivate, and remove**
users. Adding a user provisions the account on **Clerk and Convex together**. Mirrors the
proven pattern in the user's PeakWeb / BlueRock CRMs, adapted to this Vite-SPA + Convex stack.

## Scope

**In (v1):** user management only — invite (email-based), role (`admin` | `member`),
activate/deactivate, remove; a gated `/admin` route + sidebar item; an `/accept-invite`
landing page.

**Out (later):** audit-log tab, error tracking, maintenance mode, feature flags, profile-photo
upload. (PeakWeb has these; explicitly deferred.)

## Roles

Two roles: `admin` and `member`. Admins see/use the admin page and all CRM data. Members use
the CRM but cannot reach the admin page or admin actions.

## Data model — new `users` table (`convex/schema.ts`)

```
users: {
  tokenIdentifier: string,        // Clerk subject once linked; "pending:<invitationId>" before
  name: string,
  email: string,                  // normalized lowercase
  role: "admin" | "member",
  isActive: boolean,
  clerkInvitationId?: string,     // set on invite, used for revoke + link
  phone?: string,
  createdAt: number,
}
indexes: by_email [email], by_token [tokenIdentifier], by_clerk_invitation [clerkInvitationId]
```

## Auth / gating

- **`convex/lib/getAuthUser.ts`** — resolve the CRM user from the Clerk JWT: by `tokenIdentifier`
  (subject), then fall back to `by_email` using `identity.email` (this is how admin-provisioned and
  pending rows get linked on first sign-in). Returns `null` if no record.
- **`requireAdmin(ctx)`** — `getAuthUser` + `role === "admin"`, else throw. Gates admin actions.
- **Upgrade `convex/helpers.ts` `requireUser`** — keep returning the Clerk subject *string* (existing
  callers use it as `triggeredBy`), but additionally resolve the `users` row and **reject
  non-provisioned or `isActive: false`** callers. Net effect: only invited, active users can use the
  CRM, with no change to existing call sites.
  - **`IRES_DEV` ordering preserved:** the dev bypass still short-circuits — only a *real* Clerk identity
    triggers the new provisioning/active check; `IRES_DEV=1` (no identity) returns the dev subject as today,
    until we drop it. So existing dev flows don't break mid-migration.
  - Constraint: `requireUser`/`getAuthUser` read `ctx.db`, which exists only in **V8 queries/mutations**,
    not `"use node"` actions. Verified current callers are all in `*Data.ts` (V8). Actions that need the
    caller must use an internal query (`getCallerInternal`) — mirror PeakWeb. The Clerk-calling action
    (`invitations.invite`, `setActive`, `deleteUser`) validates admin via an internal query, never `ctx.db` directly.
- **First-admin seed** — `seedAdmin` mutation idempotently inserts the owner
  (`nazhossain16@gmail.com`, role `admin`, `isActive`) keyed by email, so the owner's first real
  sign-in links to an admin row. Called once (script or on-mount, dev only).

## Backend functions

`convex/users.ts` (V8 queries/mutations + internal helpers):
- `currentUser` (query) — `getAuthUser`, for the frontend gate.
- `listUsers` (query, admin-only) — all users.
- `setUserRole` (mutation, admin-only) — Convex-only; cannot change own role.
- `linkOrRejectUser` (mutation) — on first sign-in, attach `identity.subject` to the email-matched
  (or pending) row; reject if not provisioned or deactivated.
- `seedAdmin` (mutation) — idempotent owner seed.
- internal: `getCallerInternal`, `getByEmailInternal`, `getUserInternal`, `insertProvisionedUser`,
  `patchUserActive`, `deleteUserInternal`, `countUserReferences`.

`convex/invitations.ts` + the Clerk-calling pieces (`"use node"` action):
- `invite` (action, admin-only) — validate + dedupe → Clerk `POST /v1/invitations`
  (`redirect_url = CLERK_INVITE_REDIRECT_URL`, `public_metadata = {name, role, invitedBy}`, `notify:true`)
  → insert `pending:<id>` row. Rolls back the row if the Clerk call fails (and vice versa).
- `revoke` (action, admin-only) — Clerk `POST /v1/invitations/{id}/revoke` + delete pending row.
- `setActive` (action, admin-only) — patch `isActive` + Clerk lock/unlock (`POST /v1/users/{id}/lock|unlock`),
  best-effort; cannot change own status.
- `deleteUser` (action, admin-only) — guard: block if the user is referenced elsewhere (offer
  deactivate instead); else Clerk `DELETE /v1/users/{id}` then delete Convex row; cannot delete self.
- `listPending` (query, admin-only) — rows with `pending:` token.

## Frontend

IRES uses programmatic TanStack Router routes in `src/web/app.tsx` (not file-based).

- **`/admin` route** (component gated: `currentUser?.role === "admin"` else "Access Denied").
  Renders the Users management view.
- **`AdminUsersTab`** — table (Name · Email · Role dropdown · Active toggle · Delete) + filter
  chips (Active / All / Admin / Member), matching PeakWeb's layout. lucide icons only, no emojis.
- **`InviteUserDialog`** — name + email + role → `invitations.invite`; success state confirms the
  email was sent.
- **`DeleteUserButton`** — confirm dialog → `users.deleteUser`.
- **Sidebar** — add an "Admin" nav item in `app.tsx`, visible only when `currentUser?.role === "admin"`.
- **On authenticated mount**, the app calls `users.linkOrRejectUser` once to attach the Clerk subject to
  the email-matched/pending row (reads work via `getAuthUser`'s email fallback regardless; this keeps the
  fast `by_token` path correct and enforces the deactivated/not-provisioned rejection at entry).
- **`/accept-invite` route (public)** — Clerk `<SignUp>` reading the `__clerk_ticket` from the URL.
  - Wrinkle: `main.tsx` currently mounts the router only inside `<Authenticated>`. An invitee arrives
    **signed-out**, so `/accept-invite` must render without the auth gate. v1: in the `<Unauthenticated>`
    branch, if the path starts with `/accept-invite`, render the accept-invite (SignUp+ticket) component
    instead of the sign-in gate. (Minimal change; a per-route auth layout can come later.)

## Setup prerequisites (must happen for the feature to work)

1. **Add `email` + `name` claims to the Clerk `convex` JWT template.** It currently only carries
   `{"aud":"convex"}`. `getAuthUser`'s email fallback needs `identity.email`; Clerk's reserved claims
   do **not** include email. PATCH the template via the Backend API to add
   `email: "{{user.primary_email_address}}"`, `name: "{{user.full_name}}"`. Without this the seeded
   admin signs in and is rejected as "not provisioned." Verify the live token claims after patching.
2. **Convex env:** `CLERK_SECRET_KEY` (the actions call Clerk's Backend API) and
   `CLERK_INVITE_REDIRECT_URL` (dev: `http://localhost:5173/accept-invite`; prod set later).
3. **Finish the paused dev verification (same task):** run `seedAdmin` → sign in as the owner for
   real → confirm the admin page loads and a `whoami`/`currentUser` shows the real Clerk subject →
   **drop `IRES_DEV=1`** from the dev deployment. Note: while `IRES_DEV` is on, `getUserIdentity()`
   is null, so `getAuthUser` → null → the admin page shows "Access Denied" even to the owner; real
   sign-in is the only path.

## Error handling / edge cases

- Create: dedupe by email; roll back the Clerk invitation if the Convex insert fails (and vice versa).
- Delete: reference-guard (deactivate instead of orphaning data); Clerk 404 treated as already-gone.
- Self-protection: cannot change own role, deactivate self, or delete self.
- Deactivated users rejected at sign-in (`linkOrRejectUser`) even if the Clerk lock sync failed.
- Clerk API failures surface a readable message to the dialog; best-effort audit logging never fails the action.

## Verification plan

1. Patch JWT template (email claim) + set Convex env vars + run `seedAdmin`.
2. Sign in as owner → `/admin` loads, owner listed as admin.
3. Invite a test user → invitation email sent, pending row appears.
4. Accept invite in a second browser/incognito → sets password → lands signed-in; pending row links.
5. Deactivate the test user → they're rejected at next sign-in.
6. Delete the test user → removed from Clerk + Convex.
7. Drop `IRES_DEV` → signed-out is rejected; non-provisioned sign-in is rejected.

## Differences from PeakWeb (intentional)

- Roles `admin`/`member` (not admin/manager/crew).
- Single-package Vite SPA, programmatic routes (not a monorepo with file-based `_authenticated/`).
- Integrates with IRES's existing `requireUser` chokepoint + `IRES_DEV` dev bypass.
- No logs/maintenance/feature-flag/photo tabs in v1.
