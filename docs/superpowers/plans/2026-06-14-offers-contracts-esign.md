# P6 — Offers + Contracts (e-sign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`). **Standing user directive: ALL implementation runs in Opus 4.8 subagents (`model: "opus"`); two-stage review (spec then quality) per task.**

**Goal:** Add (A) offer-negotiation tracking per lead and (B) a fully serverless e-signature flow for two wholesaling contracts — seller **PSA** and buyer **Assignment** — generated from templates and signed via a public token-gated portal. Strictly additive to `/leads`.

**Architecture:** `prclid`-keyed tables mirroring the proven funnel pattern (`leadStatus`/`contacts`/`parcelEquity`). Offers feed the PSA; the assigned buyer (`leadStatus.buyerId` + `assignmentFee`) feeds the Assignment. E-sign mirrors BlueRock (no paid service, no server): `signature_pad` (browser canvas) + `@react-pdf/renderer` (browser PDF gen) → upload to Convex `_storage`; a public `/sign/$token` portal gated by an unguessable token (NOT Clerk auth). Resend email is optional + key-gated.

**Tech Stack:** Convex (V8 + node action), React + TanStack + Tailwind + shadcn, lucide-react, vitest. New npm: `@react-pdf/renderer`, `pdf-lib`, `signature_pad` (all MIT, browser-side).

**Spec:** `docs/superpowers/specs/2026-06-14-offers-contracts-esign-design.md` (APPROVED).
**BlueRock reference (MIT, copy/adapt):** `C:\Users\nazho\Desktop\blue-rock-crm` —
`packages/crm-core/src/components/portal/SignaturePad.tsx`, `packages/crm-core/src/lib/trim-signature.ts` (+ `.test.ts`),
`packages/crm-core/src/components/leads/ContractPDF.tsx` (react-pdf API patterns + signature rendering),
`packages/crm-core/src/components/portal/AcceptanceBlock.tsx` (sign → PDF → upload → accept flow).

**Branch:** `feat/p6-offers-contracts` (already created off `main`; the spec is committed here). The build is **staged**: Stage 0 (deps) → A (offers) → B (contracts data) → C (PDF/portal/UI) → D (optional Resend) → E (final). Each task = its own commit; `npm run build` + full vitest green per task; explicit `git add <paths>` (never `git add -A` — repo has untracked artifacts `.agents/`, `.claude/`, `_preview.png`, `skills-lock.json`).

**Convex/Windows notes (project lessons):** after editing `convex/`, run `npx convex dev --once` (validates + regenerates `_generated`; the Node24 `UV_HANDLE_CLOSING` assertion AFTER the output is COSMETIC — trust the output). A `"use node"` file = actions only. Annotate every action handler that calls siblings with an explicit `Promise<...>` return type (TS7023). Storage (`ctx.storage`) is NEW to this project.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | add `@react-pdf/renderer`, `pdf-lib`, `signature_pad` | Modify |
| `src/web/contracts/SignaturePad.tsx` | drawn-signature canvas (copied from BlueRock, MIT) | Create |
| `src/scraper/trimSignature.ts` + `tests/trimSignature.test.ts` | signature PNG bounding-box trim (copied from BlueRock) | Create |
| `src/scraper/offers.ts` + `tests/offers.test.ts` | pure offer status transitions + `summarizeOffers` | Create |
| `src/scraper/contracts.ts` + `tests/contracts.test.ts` | pure term builders, name-match, token/expiry guards, sanitize, transitions | Create |
| `convex/schema.ts` | add `offers` + `contracts` tables | Modify (after `parcelEquity`) |
| `convex/offerData.ts` | offers V8 data layer | Create |
| `convex/contractData.ts` | contracts V8 data layer (team auth + public token-gated portal fns + storage) | Create |
| `convex/contractActions.ts` | OPTIONAL Resend email (key-gated, no-op if unset) | Create |
| `src/web/contracts/ContractPDF.tsx` | react-pdf doc: PSA or Assignment from `terms` + signature | Create |
| `src/web/contracts/SignPortal.tsx` | the public `/sign/$token` portal component | Create |
| `src/web/main.tsx` | mount `SignPortal` before the auth gate (mirror `onAcceptInvite`) | Modify |
| `src/web/LeadsPage.tsx` | `LeadOffers` + `LeadContracts` panels + render in expanded row | Modify |

---

## Pre-flight (orchestrator)
- [ ] Confirm on branch `feat/p6-offers-contracts`, baseline `npm run build` + `npx vitest run` green BEFORE Stage 0.

---

## Stage 0 — Dependencies + copied BlueRock files

### Task 0: install deps + copy signature primitives

**Files:** `package.json`; `src/web/contracts/SignaturePad.tsx`; `src/scraper/trimSignature.ts` + `tests/trimSignature.test.ts`.

- [ ] **Step 0.1** Install: `npm install @react-pdf/renderer pdf-lib signature_pad` (pins land in package.json/package-lock).
- [ ] **Step 0.2** Copy `blue-rock-crm/packages/crm-core/src/lib/trim-signature.ts` → `src/scraper/trimSignature.ts` and its test → `tests/trimSignature.test.ts`. Adjust the import path in the test to `../src/scraper/trimSignature`. (It's a pure RGBA bounding-box scanner — keep verbatim aside from the path.) Run `npx vitest run tests/trimSignature.test.ts` → green.
- [ ] **Step 0.3** Copy `blue-rock-crm/packages/crm-core/src/components/portal/SignaturePad.tsx` → `src/web/contracts/SignaturePad.tsx`. Fix imports: it imports the trim helper (point to `@/` or relative `../../scraper/trimSignature`) and `signature_pad`. It should import ONLY what exists here (likely the trim helper + the `signature_pad` lib + React). Remove any BlueRock-specific imports that don't exist in IRES; keep it a self-contained canvas component exposing a way to read the trimmed PNG data-URI (e.g. a ref method `exportTrimmedPng()` or an `onChange(dataUri)` — preserve BlueRock's interface).
- [ ] **Step 0.4** `npm run build` → clean (the new component compiles; it's not mounted yet).
- [ ] **Step 0.5** Commit: `git add package.json package-lock.json src/web/contracts/SignaturePad.tsx src/scraper/trimSignature.ts tests/trimSignature.test.ts && git commit -m "feat(p6): add e-sign deps + copy BlueRock SignaturePad + trim-signature (MIT)"`

> If `SignaturePad.tsx`'s BlueRock interface is unclear, READ BlueRock's `AcceptanceBlock.tsx` to see how it's consumed, and preserve that exact interface so Task C2 can reuse it. Report DONE_WITH_CONCERNS if the copy needed non-trivial changes.

---

## Stage A — Offer tracking

### Task A1: pure `src/scraper/offers.ts` — TDD

**Files:** Create `src/scraper/offers.ts`, `tests/offers.test.ts`. Mirror the house style of `src/scraper/equity.ts` (header comment, named exports, zero deps).

- [ ] **Step A1.1 — write tests** (`tests/offers.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { canTransition, summarizeOffers, isOfferStatus, type OfferLike } from "../src/scraper/offers";

const mk = (o: Partial<OfferLike>): OfferLike => ({ amount: 100000, status: "pending", createdAt: 1, ...o });

describe("isOfferStatus", () => {
  it("validates", () => {
    expect(isOfferStatus("accepted")).toBe(true);
    expect(isOfferStatus("nope")).toBe(false);
  });
});
describe("canTransition", () => {
  it("allows non-terminal → other status", () => {
    expect(canTransition("pending", "accepted")).toBe(true);
    expect(canTransition("pending", "countered")).toBe(true);
    expect(canTransition("countered", "accepted")).toBe(true);
  });
  it("blocks terminal → anything and same → same", () => {
    expect(canTransition("accepted", "rejected")).toBe(false);
    expect(canTransition("rejected", "pending")).toBe(false);
    expect(canTransition("pending", "pending")).toBe(false);
  });
});
describe("summarizeOffers", () => {
  it("latest by createdAt, active count, accepted offer + price", () => {
    const offers = [
      mk({ amount: 90000, status: "rejected", createdAt: 1 }),
      mk({ amount: 95000, status: "accepted", createdAt: 3 }),
      mk({ amount: 92000, status: "pending", createdAt: 2 }),
    ];
    const s = summarizeOffers(offers);
    expect(s.latest!.createdAt).toBe(3);
    expect(s.activeCount).toBe(1);          // only the pending one
    expect(s.acceptedOffer!.amount).toBe(95000);
    expect(s.acceptedPrice).toBe(95000);
  });
  it("empty → nulls", () => {
    expect(summarizeOffers([])).toEqual({ latest: null, activeCount: 0, acceptedOffer: null, acceptedPrice: null });
  });
});
```
- [ ] **Step A1.2 — run red:** `npx vitest run tests/offers.test.ts` → FAIL.
- [ ] **Step A1.3 — implement** `src/scraper/offers.ts`:
```ts
// Pure offer-negotiation logic for P6. Zero-dep; imported by the Convex offer layer
// AND the LeadOffers UI. Spec: docs/superpowers/specs/2026-06-14-offers-contracts-esign-design.md.

export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired";
export const OFFER_STATUSES: OfferStatus[] = ["pending", "countered", "accepted", "rejected", "withdrawn", "expired"];
const TERMINAL: OfferStatus[] = ["accepted", "rejected", "withdrawn", "expired"];

export interface OfferLike {
  _id?: string;
  amount: number;
  status: OfferStatus;
  counterAmount?: number;
  earnestMoney?: number;
  closingDate?: string;
  inspectionDays?: number;
  notes?: string;
  createdAt: number;
}

export function isOfferStatus(s: string): s is OfferStatus {
  return (OFFER_STATUSES as string[]).includes(s);
}

/** A non-terminal offer (pending|countered) may move to any OTHER status; terminal states are final. */
export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  return true;
}

export function summarizeOffers(offers: OfferLike[]): {
  latest: OfferLike | null;
  activeCount: number;
  acceptedOffer: OfferLike | null;
  acceptedPrice: number | null;
} {
  const sorted = [...offers].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0] ?? null;
  const activeCount = offers.filter((o) => o.status === "pending" || o.status === "countered").length;
  const acceptedOffer = sorted.find((o) => o.status === "accepted") ?? null;
  return { latest, activeCount, acceptedOffer, acceptedPrice: acceptedOffer?.amount ?? null };
}
```
- [ ] **Step A1.4 — green:** `npx vitest run tests/offers.test.ts` → PASS.
- [ ] **Step A1.5 — commit:** `git add src/scraper/offers.ts tests/offers.test.ts && git commit -m "feat(p6): pure offer transitions + summarizeOffers (TDD)"`

### Task A2: `offers` schema + `convex/offerData.ts`

**Files:** Modify `convex/schema.ts` (add after `parcelEquity`); Create `convex/offerData.ts`. Mirror `convex/equityData.ts` (shared-team `requireUser`; server-side email via `getAuthUser`, per `errors.ts`).

- [ ] **Step A2.1 — schema** (insert after the `parcelEquity` table block, before `errorLogs`):
```ts
  // P6 offers — negotiation thread to the OWNER, prclid-keyed (funnel-only, mirrors parcelEquity).
  // Status transitions guarded by src/scraper/offers.ts. Spec: 2026-06-14-offers-contracts-esign-design.md.
  offers: defineTable({
    prclid: v.string(),
    amount: v.number(),
    status: v.union(
      v.literal("pending"), v.literal("countered"), v.literal("accepted"),
      v.literal("rejected"), v.literal("withdrawn"), v.literal("expired"),
    ),
    counterAmount: v.optional(v.number()),
    earnestMoney: v.optional(v.number()),
    closingDate: v.optional(v.string()),
    inspectionDays: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdByEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),
```
- [ ] **Step A2.2 — `convex/offerData.ts`:**
```ts
import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";
import { getAuthUser } from "./lib/getAuthUser";
import { canTransition, isOfferStatus, type OfferStatus } from "../src/scraper/offers";
import { ConvexError } from "convex/values";

const statusV = v.union(
  v.literal("pending"), v.literal("countered"), v.literal("accepted"),
  v.literal("rejected"), v.literal("withdrawn"), v.literal("expired"),
);

export const offersForParcel = query({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("offers").withIndex("by_prclid", (q) => q.eq("prclid", prclid)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const addOffer = mutation({
  args: {
    prclid: v.string(), amount: v.number(),
    earnestMoney: v.optional(v.number()), closingDate: v.optional(v.string()),
    inspectionDays: v.optional(v.number()), notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    const me = await getAuthUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("offers", {
      prclid: a.prclid, amount: a.amount, status: "pending",
      earnestMoney: a.earnestMoney, closingDate: a.closingDate,
      inspectionDays: a.inspectionDays, notes: a.notes,
      createdByEmail: me?.email, createdAt: now, updatedAt: now,
    });
  },
});

export const updateOfferStatus = mutation({
  args: { offerId: v.id("offers"), status: statusV, counterAmount: v.optional(v.number()) },
  handler: async (ctx, { offerId, status, counterAmount }) => {
    await requireUser(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new ConvexError({ code: "NOT_FOUND", message: "Offer not found" });
    if (!canTransition(offer.status as OfferStatus, status)) {
      throw new ConvexError({ code: "BAD_TRANSITION", message: `Cannot move offer from ${offer.status} to ${status}` });
    }
    await ctx.db.patch(offerId, {
      status,
      ...(counterAmount !== undefined ? { counterAmount } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const deleteOffer = mutation({
  args: { offerId: v.id("offers") },
  handler: async (ctx, { offerId }) => {
    await requireUser(ctx);
    await ctx.db.delete(offerId);
  },
});

/** For the contract builder: the accepted offer (if any) for a parcel. */
export const getAcceptedOfferInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    const rows = await ctx.db.query("offers").withIndex("by_prclid", (q) => q.eq("prclid", prclid)).collect();
    return rows.find((o) => o.status === "accepted") ?? null;
  },
});
```
> Drop the unused `isOfferStatus` import if not used, to keep lint clean.
- [ ] **Step A2.3** `npx convex dev --once` (codegen) → `npm run build` clean.
- [ ] **Step A2.4 — commit:** `git add convex/schema.ts convex/offerData.ts convex/_generated && git commit -m "feat(p6): offers schema + V8 data layer"`

### Task A3: `LeadOffers` UI panel

**Files:** Modify `src/web/LeadsPage.tsx` — add a `LeadOffers({ prclid })` component (after `LeadContacts`'s slot pattern; but note P6 is on a branch WITHOUT P5, so place it after `LeadEquity`) and render it in the expanded row. Mirror `LeadEquity`/`LeadFollowUps` conventions (panel wrapper `space-y-2 border-t border-border/50 px-4 py-3`, teal button class, `describeError`, lucide icons, `fmtMoney`/`fmtDate`).

- [ ] **Step A3.1** Add `LeadOffers({ prclid }: { prclid: string })`:
  - `const offers = useQuery(api.offerData.offersForParcel, { prclid });` `const add = useMutation(api.offerData.addOffer);` `const updateStatus = useMutation(api.offerData.updateOfferStatus);` `const del = useMutation(api.offerData.deleteOffer);` `const setStatus = useMutation(api.pipelineData.setLeadStatus);`
  - Import `summarizeOffers` from `../scraper/offers`.
  - **Thread:** list offers newest-first — amount (`fmtMoney`), a status badge (color by status: accepted=teal, rejected/withdrawn/expired=muted/red, pending/countered=amber), counterAmount if present, terms (earnest/closing/inspection), notes, `createdByEmail` + `fmtDate(createdAt)`. Per-offer controls (only for non-terminal offers): a shadcn `Select` to set status (the 6 statuses; guard client-side using `canTransition` to disable invalid moves), a counter-amount input shown when choosing `countered`, and a delete (trash) button.
  - **Add-offer form:** amount input (required), optional earnestMoney / closingDate (date input) / inspectionDays / notes; "Add offer" button → `add({...})`; busy + `describeError`.
  - **Accepted-offer affordance:** if `summarizeOffers(offers).acceptedOffer`, show a row: "Offer accepted: {price}" + a one-click **"Move to under_contract"** button → `setStatus({ prclid, stage: "under_contract" })` (not forced). (The "Generate purchase agreement" button is added in Task C3 — leave a clear comment placeholder here, no code.)
  - Loading (`offers === undefined`) → "Loading…"; empty → "No offers yet."
- [ ] **Step A3.2** Render `<LeadOffers key={`of-${l.prclid}`} prclid={l.prclid} />` in the expanded `<tr>` right after `<LeadEquity .../>`.
- [ ] **Step A3.3** `npm run build` clean; `npx vitest run` green.
- [ ] **Step A3.4 — commit:** `git add src/web/LeadsPage.tsx && git commit -m "feat(p6): LeadOffers panel — offer thread, statuses, accepted→under_contract"`

---

## Stage B — Contracts: pure logic + data layer

### Task B1: pure `src/scraper/contracts.ts` — TDD

**Files:** Create `src/scraper/contracts.ts`, `tests/contracts.test.ts`.

- [ ] **Step B1.1 — write tests** covering: `buildPsaTerms` (maps lead+offer → terms with price/earnest/closing/inspection, sellerName=ownerName, buyerEntity, signerRole "seller", signerName=ownerName); `buildAssignmentTerms` (lead+buyer+fee → terms with assigneeName=buyer.name, assignmentFee, signerRole "buyer", signerName=buyer.name); `isSignerNameMatch` ("  John  Smith " vs "john smith" → true; "Jane" vs "John" → false); `isTokenExpired`/`canAccept` (status "sent" + not expired → canAccept true; "draft"/"signed"/expired → false); `sanitizeFilename` ("Jän/e:*.pdf" → safe, ≤120 chars); `canContractTransition` (draft→sent true, sent→signed/declined/voided true, signed→anything false).
- [ ] **Step B1.2 — run red.**
- [ ] **Step B1.3 — implement** `src/scraper/contracts.ts`:
```ts
// Pure contract logic for P6 e-sign. Zero-dep; imported by the Convex contract layer,
// the ContractPDF, and the SignPortal. Spec: 2026-06-14-offers-contracts-esign-design.md.

export type ContractType = "psa" | "assignment";
export type ContractStatus = "draft" | "sent" | "signed" | "declined" | "voided";
export const CONTRACT_STATUSES: ContractStatus[] = ["draft", "sent", "signed", "declined", "voided"];

export interface ContractTerms {
  propertyAddress: string;
  buyerEntity: string;
  sellerName?: string;
  price?: number;
  earnestMoney?: number;
  closingDate?: string;
  inspectionDays?: number;
  assigneeName?: string;
  assignmentFee?: number;
  underlyingContractRef?: string;
}

export interface PsaLeadInput { propertyAddress: string; ownerName?: string; }
export interface PsaOfferInput { amount: number; earnestMoney?: number; closingDate?: string; inspectionDays?: number; }

export function buildPsaTerms(
  lead: PsaLeadInput, offer: PsaOfferInput, buyerEntity: string,
): { terms: ContractTerms; signerName: string; signerRole: "seller" } {
  const sellerName = lead.ownerName ?? "Property Owner";
  return {
    terms: {
      propertyAddress: lead.propertyAddress, buyerEntity, sellerName,
      price: offer.amount, earnestMoney: offer.earnestMoney,
      closingDate: offer.closingDate, inspectionDays: offer.inspectionDays,
    },
    signerName: sellerName, signerRole: "seller",
  };
}

export function buildAssignmentTerms(
  lead: { propertyAddress: string }, buyer: { name: string }, assignmentFee: number,
  buyerEntity: string, underlyingContractRef?: string,
): { terms: ContractTerms; signerName: string; signerRole: "buyer" } {
  return {
    terms: {
      propertyAddress: lead.propertyAddress, buyerEntity,
      assigneeName: buyer.name, assignmentFee, underlyingContractRef,
    },
    signerName: buyer.name, signerRole: "buyer",
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function isSignerNameMatch(typed: string, expected: string): boolean {
  return norm(typed) === norm(expected) && norm(typed).length > 0;
}

export function isTokenExpired(c: { expiresAt: number }, now: number): boolean {
  return now > c.expiresAt;
}
export function canAccept(c: { status: ContractStatus; expiresAt: number }, now: number): boolean {
  return c.status === "sent" && !isTokenExpired(c, now);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "contract";
}

const NEXT: Record<ContractStatus, ContractStatus[]> = {
  draft: ["sent", "voided"],
  sent: ["signed", "declined", "voided"],
  signed: [], declined: [], voided: [],
};
export function canContractTransition(from: ContractStatus, to: ContractStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}
```
- [ ] **Step B1.4 — green; Step B1.5 — commit:** `git add src/scraper/contracts.ts tests/contracts.test.ts && git commit -m "feat(p6): pure contract term builders + name-match + token/transition guards (TDD)"`

### Task B2: `contracts` schema + `convex/contractData.ts`

**Files:** Modify `convex/schema.ts` (add `contracts` after `offers`); Create `convex/contractData.ts`. This is the security-critical task — team functions use `requireUser`; the public PORTAL functions use NO `requireUser` and are gated SOLELY by the secret token (re-validate token + expiry + state on every call). Mirror `contactData`/`equityData` for the team side; introduce the Convex storage pattern.

- [ ] **Step B2.1 — schema** (`contracts` table; indexes `by_prclid`, `by_token`):
```ts
  // P6 contracts — PSA (seller) + Assignment (buyer) with a serverless e-sign lifecycle.
  // PORTAL fns are gated by `publicToken` (unguessable), NOT auth. terms = frozen snapshot at send.
  // Spec: 2026-06-14-offers-contracts-esign-design.md.
  contracts: defineTable({
    prclid: v.string(),
    type: v.union(v.literal("psa"), v.literal("assignment")),
    status: v.union(
      v.literal("draft"), v.literal("sent"), v.literal("signed"),
      v.literal("declined"), v.literal("voided"),
    ),
    terms: v.object({
      propertyAddress: v.string(),
      buyerEntity: v.string(),
      sellerName: v.optional(v.string()),
      price: v.optional(v.number()),
      earnestMoney: v.optional(v.number()),
      closingDate: v.optional(v.string()),
      inspectionDays: v.optional(v.number()),
      assigneeName: v.optional(v.string()),
      assignmentFee: v.optional(v.number()),
      underlyingContractRef: v.optional(v.string()),
    }),
    signerName: v.string(),
    signerEmail: v.optional(v.string()),
    signerRole: v.union(v.literal("seller"), v.literal("buyer")),
    publicToken: v.optional(v.string()),
    tokenCreatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    acceptedByName: v.optional(v.string()),
    acceptedUserAgent: v.optional(v.string()),
    acknowledgments: v.optional(v.object({ bindingContract: v.boolean() })),
    signatureMode: v.optional(v.union(v.literal("typed"), v.literal("drawn"))),
    signedStorageId: v.optional(v.id("_storage")),
    signedFilename: v.optional(v.string()),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    createdByEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_prclid", ["prclid"])
    .index("by_token", ["publicToken"]),
```
- [ ] **Step B2.2 — `convex/contractData.ts`.** Implement these functions (mirror house style; `ConvexError` for user-facing throws; `getAuthUser` for `createdByEmail`):

  **Team (auth-gated, `requireUser`):**
  - `contractsForParcel(prclid)` query → rows newest-first.
  - `createContract({ prclid, type })` mutation: read the spine parcel (reuse `internal.equityData.getParcelInternal` via a direct `ctx.db` query here since this is V8 — query `parcels` `by_prclid`), build the address. For **psa**: read the accepted offer (`offers` by_prclid → status "accepted"); throw `ConvexError("No accepted offer to generate a PSA")` if none; `buildPsaTerms(lead, offer, BUYER_ENTITY)`. For **assignment**: read `leadStatus` by_prclid → require `buyerId` + `assignmentFee`; load the buyer; throw if missing; `buildAssignmentTerms(...)`. Insert `status:"draft"`, terms, signerName, signerRole, `createdByEmail`, timestamps. `BUYER_ENTITY` = a const default (e.g. `"Instant Real Estate Solution"`).
  - `sendContract({ contractId, signerEmail? })` mutation: guard `canContractTransition(status, "sent")`; mint `publicToken` = 32-byte hex via `crypto.getRandomValues(new Uint8Array(32))` → hex; set `tokenCreatedAt=now`, `expiresAt=now+30*864e5`, `status:"sent"`, `signerEmail?`. Return `{ token }`.
  - `voidContract({ contractId })` mutation: `canContractTransition(status,"voided")` → set `status:"voided"`, clear nothing else (token now fails canAccept).
  - `getSignedUrl({ contractId })` query: `requireUser`; if `signedStorageId` → `return await ctx.storage.getUrl(signedStorageId)` else null.

  **Public (PORTAL — NO `requireUser`; token is the credential). Each re-validates the token:**
  - `getContractByToken({ token })` query: look up via `by_token`; if none / `status==="voided"` → return `{ found: false }`; else return a SAFE projection `{ found: true, type, status, terms, signerName, signerRole, expiresAt, acceptedAt, signed: status==="signed" }` (never expose other parcels' data; do not return `prclid` unless needed by the portal — it isn't).
  - `generateSignUploadUrl({ token })` mutation: look up by token; `canAccept(contract, Date.now())` else throw `ConvexError`; `return await ctx.storage.generateUploadUrl()`.
  - `acceptContract({ token, signedStorageId, signatureMode, acceptedByName, acknowledgments, userAgent })` mutation: look up by token; if already `signed` → return `{ alreadySigned: true }` (two-tab safety); require `canAccept`; if `signatureMode==="typed"` enforce `isSignerNameMatch(acceptedByName, contract.signerName)` else throw `ConvexError("Typed name doesn't match …")`; set `acceptedAt`, `acceptedByName`, `acceptedUserAgent: userAgent`, `acknowledgments`, `signatureMode`, `signedStorageId`, `signedFilename = sanitizeFilename(\`${type}-${signerName}-signed.pdf\`)`, `status:"signed"`. (Optionally schedule `internal.contractActions.emailSignedCopy` — only if it exists/Task D done; otherwise omit.)
  - `declineContract({ token, reason? })` mutation: look up; require status `sent`; set `status:"declined"`, `declinedAt`, `declineReason`.

  **Internal (CLI/verify + action support):** `getContractInternal({ contractId })` internalQuery.

  Types: import the pure types/guards from `../src/scraper/contracts` (`canContractTransition`, `canAccept`, `isSignerNameMatch`, `sanitizeFilename`, `ContractStatus`). Annotate `createContract` if it calls siblings (it shouldn't need to — it's a mutation reading ctx.db directly). Use a shared `tokenLookup(ctx, token)` helper inside the file (DRY across the 4 public fns).

- [ ] **Step B2.3** `npx convex dev --once` → `npm run build` clean. (No live calls.)
- [ ] **Step B2.4 — commit:** `git add convex/schema.ts convex/contractData.ts convex/_generated && git commit -m "feat(p6): contracts schema + data layer (team auth + token-gated portal + storage)"`

---

## Stage C — PDF + portal + contracts UI

### Task C1: `ContractPDF.tsx` (react-pdf)

**Files:** Create `src/web/contracts/ContractPDF.tsx`. READ BlueRock's `packages/crm-core/src/components/leads/ContractPDF.tsx` for the `@react-pdf/renderer` API (Document/Page/View/Text/StyleSheet, Image for the drawn signature) and the three-way signature rendering (drawn PNG `<Image>` / typed italic name / blank).

- [ ] **Step C1.1** Implement a `<ContractPDF terms signatureDataUri? typedName? signerRole acceptedDate? type />` Document that renders, scaled by `type`:
  - **psa:** title "Purchase & Sale Agreement", parties (buyerEntity ↔ sellerName), property, price, earnest money, closing date, inspection period, a standard body (offer/acceptance, as-is, default), and a signature block (seller). 
  - **assignment:** title "Assignment of Contract", parties (assignor=buyerEntity ↔ assignee=assigneeName), property, the underlying PSA ref, assignment fee, and a signature block (buyer/assignee).
  - Signature block: if `signatureDataUri` → `<Image src={signatureDataUri}/>`; else if `typedName` → italic typed name; print name + `acceptedDate`.
  - A footer disclaimer on every page: "This document is a template for convenience and is NOT legal advice. Consult an attorney."
  - Keep template legal copy in clearly-marked constants at the top of the file for easy review/replacement.
- [ ] **Step C1.2** `npm run build` clean (component compiles; not yet mounted). Commit: `git add src/web/contracts/ContractPDF.tsx && git commit -m "feat(p6): ContractPDF (react-pdf) — PSA + assignment templates"`

### Task C2: `SignPortal.tsx` + mount before the auth gate

**Files:** Create `src/web/contracts/SignPortal.tsx`; Modify `src/web/main.tsx`. READ BlueRock's `AcceptanceBlock.tsx` for the sign→PDF→upload→accept browser flow.

- [ ] **Step C2.1** `SignPortal.tsx`: read the token from `window.location.pathname` (`/sign/{token}`). `const contract = useQuery(api.contractData.getContractByToken, { token });` States: loading; `!found` → "This signing link is invalid or no longer active."; `signed`/`acceptedAt` → "Signed — thank you." + (optional) download via a public link if exposed; `declined` → declined message; else (sent, not expired) render the **review + sign** UI:
  - Render the contract terms as readable HTML (from `contract.terms`, scaled by `type`).
  - Mode toggle typed ↔ drawn. Typed: a name input. Drawn: the copied `SignaturePad` (export trimmed PNG). One required consent checkbox ("I intend to sign; this is a legally binding electronic signature").
  - On submit: build the signed PDF in-browser — `import { pdf } from "@react-pdf/renderer"` → `const blob = await pdf(<ContractPDF terms={contract.terms} type={contract.type} signerRole={contract.signerRole} signatureDataUri={drawnPng} typedName={typedName} acceptedDate={…}/>).toBlob();` → `const url = await generateSignUploadUrl({ token });` → `await fetch(url, { method:"POST", headers:{"Content-Type":"application/pdf"}, body: blob })` → `const { storageId } = await res.json();` → `await acceptContract({ token, signedStorageId: storageId, signatureMode, acceptedByName, acknowledgments:{bindingContract:true}, userAgent: navigator.userAgent });`. Handle errors via `describeError`. lucide icons only; reuse the dark theme tokens.
  - `const generateSignUploadUrl = useMutation(api.contractData.generateSignUploadUrl); const acceptContract = useMutation(api.contractData.acceptContract); const declineContract = useMutation(api.contractData.declineContract);`
  - A "Decline" action → `declineContract({ token })`.
- [ ] **Step C2.2** `main.tsx`: mirror `onAcceptInvite` — add `const onSign = window.location.pathname.startsWith("/sign/");` and render `SignPortal` for that path REGARDLESS of auth (before/around the `Authenticated`/`Unauthenticated` gate), e.g.:
```tsx
{onSign ? (
  <SignPortal />
) : (
  <>
    <AuthLoading>…</AuthLoading>
    <Authenticated><AuthedApp /></Authenticated>
    <Unauthenticated>{onAcceptInvite ? <AcceptInvite /> : <SignInGate />}</Unauthenticated>
  </>
)}
```
  (Keep it inside `ConvexProviderWithClerk` so the portal can call Convex; the token-gated public fns work without a signed-in identity.)
- [ ] **Step C2.3** `npm run build` clean; `npx vitest run` green. Commit: `git add src/web/contracts/SignPortal.tsx src/web/main.tsx && git commit -m "feat(p6): public /sign/$token signing portal (token-gated, serverless e-sign)"`

### Task C3: `LeadContracts` UI panel

**Files:** Modify `src/web/LeadsPage.tsx` — add `LeadContracts({ prclid, lead })` after `LeadOffers`; render in the expanded row. Mirror the sibling panels.

- [ ] **Step C3.1** Implement:
  - `const contracts = useQuery(api.contractData.contractsForParcel, { prclid });` mutations: `createContract`, `sendContract`, `voidContract`; `const getSignedUrl = useMutation? ` — note `getSignedUrl` is a query; call it via `useConvex().query` on click or a small `useState`-triggered `useQuery`. Simpler: expose the signed download by opening `getSignedUrl` result — implement a "Download signed" button that calls a `useAction`/`useConvex().query(api.contractData.getSignedUrl,{contractId})` then `window.open(url)`.
  - **Generate buttons:** "Generate PSA" (enabled when an accepted offer exists — derive from `useQuery(api.offerData.offersForParcel)` + `summarizeOffers`, or just always enabled and let the mutation throw a friendly error) → `createContract({ prclid, type:"psa" })`. "Generate Assignment" (enabled when the lead has an assigned buyer — `lead.buyerId`/`lead.assignmentFee` if present on the lead row; else let the mutation throw) → `createContract({ prclid, type:"assignment" })`.
  - **Per contract:** type + status badge; for `draft` → "Send" button (`sendContract` → mints token); for `sent` → **"Copy signing link"** (`${window.location.origin}/sign/${token}`) — but the token isn't returned by `contractsForParcel`'s safe projection unless included; INCLUDE `publicToken` in the team-side `contractsForParcel` result (team is authed, so returning the token to them is fine) so the panel can build the link; also show "awaiting signature"; for `signed` → "Signed by {acceptedByName} on {fmtDate(acceptedAt)}" + "Download signed PDF"; any non-terminal → "Void".
  - `describeError`, busy states, lucide icons, dark theme.
- [ ] **Step C3.2** Render `<LeadContracts key={`ct-${l.prclid}`} prclid={l.prclid} lead={l} />` after `<LeadOffers/>`.
- [ ] **Step C3.3** If the link needs the token, ensure `contractData.contractsForParcel` returns `publicToken` (team-only, authed). `npm run build` clean; `npx vitest run` green.
- [ ] **Step C3.4 — commit:** `git add src/web/LeadsPage.tsx convex/contractData.ts convex/_generated && git commit -m "feat(p6): LeadContracts panel — generate/send/copy-link/download/void"`

---

## Stage D — Optional Resend email (key-gated)

### Task D1: `convex/contractActions.ts`

**Files:** Create `convex/contractActions.ts` (`"use node"`). READ `blue-rock-crm/packages/crm-core/convex/publicEstimate.ts` (`emailSignedContract`) for the Resend HTTP + base64 PDF pattern.

- [ ] **Step D1.1** Implement two internal-or-public actions, BOTH **no-op-with-log when `RESEND_API_KEY` is unset** (never throw into the UI):
  - `emailSigningRequest({ contractId })`: if no key → log + return `{ sent:false, reason:"no key" }`. Else fetch the contract (internal query), require `signerEmail` + token, send via Resend the link `${process.env.PORTAL_BASE_URL}/sign/${token}`.
  - `emailSignedCopy({ contractId })`: if no key → no-op; else fetch signed PDF bytes via `ctx.storage.get(signedStorageId)` (or `getUrl` + fetch), base64-encode, email to the team (and CC signer if `signerEmail`), drop attachment + link if > ~36 MB.
  - Explicit `Promise<...>` return types. Use `fetch("https://api.resend.com/emails", { headers:{Authorization:\`Bearer ${key}\`}, … , signal: AbortSignal.timeout(30_000) })`.
  - Wire (optional): `sendContract` schedules `emailSigningRequest` when `signerEmail` is set; `acceptContract` schedules `emailSignedCopy`. Both are best-effort.
- [ ] **Step D1.2** `npx convex dev --once` → `npm run build` clean. Commit: `git add convex/contractActions.ts convex/contractData.ts convex/_generated && git commit -m "feat(p6): optional Resend email for signing request + signed copy (key-gated)"`

---

## Stage E — Final verification + memory

### Task E (orchestrator-run, not a subagent)
- [ ] Full gate: `npx convex dev --once` → `npm run build` → `npx vitest run` all green.
- [ ] Additive check: `git diff main --stat` — only the P6 files; no behavioral change to sheriff/legal/flip/properties/parcels/signals/equity. The shared-file edits are `convex/schema.ts` (2 tables), `src/web/LeadsPage.tsx` (2 panels), `src/web/main.tsx` (portal mount), `package.json` (3 deps).
- [ ] Manual-verify script (record): create offer → accept → Generate PSA → Send → copy link → open `/sign/$token` logged-out → review → sign typed + drawn → signed PDF stores/downloads + status flips; decline + void + expiry; Assignment from an assigned buyer. Resend verified separately once a key is set.
- [ ] Memory update (reconcile with the P5 branch's memory at merge time): record P6 built, the new `/sign` public route, the new deps, the optional Resend env vars, and the cross-branch merge note (P5 + P6 both add to `schema.ts`/`_generated` → the second to merge regenerates `_generated`).

---

## Self-Review (run before dispatching)
**Spec coverage:** offers (A1–A3) ✓ · contracts data + token-gated portal fns + storage (B1–B2) ✓ · ContractPDF (C1) ✓ · public portal route + mount (C2) ✓ · LeadOffers + LeadContracts UI (A3, C3) ✓ · optional Resend (D1) ✓ · copy-link-first, Resend gated ✓ · ESIGN forensic fields + name-match + disclaimer ✓ · additive guarantee (E) ✓. Deferred per spec (R2, SMS, counter-signature, audit page, template editor, reminders cron) NOT built.
**Placeholders:** none — pure modules + schema have full code; integration tasks reference exact files to mirror + the exact Convex/storage/router patterns.
**Type consistency:** `OfferLike`/`offers` schema/`offerData` args align; `ContractTerms`/`contracts.terms` schema/`createContract` align; `canAccept`/`isSignerNameMatch`/`sanitizeFilename` used consistently in `contractData`. The team `contractsForParcel` returns `publicToken` (authed) so the UI can build the link; the public `getContractByToken` does NOT leak it/other data.
**Security:** portal mutations are public but re-validate token+expiry+state every call; storage upload gated; typed-name enforced; team fns keep `requireUser`.
