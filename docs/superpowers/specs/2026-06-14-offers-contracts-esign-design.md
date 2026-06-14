# P6 — Offers + Contracts (e-sign) Design

_Date: 2026-06-14. Status: APPROVED (user, this session). The sixth pipeline phase from
`2026-06-11-wholesaling-pipeline-crm.md`. Adds offer-negotiation tracking per lead AND a fully
serverless e-signature flow for two wholesaling contracts — the seller **Purchase & Sale Agreement
(PSA)** and the buyer **Assignment of Contract** — both generated from templates and signed via a
public token-gated portal. Strictly additive. **Legal framing is informational, NOT legal advice** —
the generated templates are starting points for attorney review; the e-sign captures intent per the
U.S. ESIGN Act but is not a substitute for legal counsel._

## Provenance / reference
The e-sign mechanics mirror the **BlueRock CRM** (`C:\Users\nazho\Desktop\blue-rock-crm`), which uses
NO proprietary e-sign service (no DocuSign/Documenso/OpenSign). Its proven, fully-serverless pattern:
`signature_pad` (MIT, browser canvas) + `@react-pdf/renderer` (browser PDF generation) + `pdf-lib`
(merge) + a public token route + storage + Resend. Reusable files to copy verbatim (MIT):
`packages/crm-core/src/components/portal/SignaturePad.tsx` and
`packages/crm-core/src/lib/trim-signature.ts` (+ its test). Reference design:
`blue-rock-crm/docs/superpowers/specs/2026-05-20-drawn-signature-design.md`;
legal posture: `blue-rock-crm/docs/portal-legal-compliance-report.md`.

## Locked scope decisions (user-confirmed)
1. **Both contracts:** seller **PSA** (the distressed OWNER signs to sell to IRES) + buyer
   **Assignment** (the cash BUYER signs to take the deal for the assignment fee).
2. **Documents are GENERATED from templates** (in-browser `@react-pdf/renderer`), not uploaded. One
   built-in template per type; fields auto-fill from the lead + the accepted offer (PSA) / the
   assigned buyer (Assignment).
3. **Delivery: copy-link first, Resend optional.** The CRM mints a signing link the team copies and
   sends however they want — **zero new infra, fully buildable + verifiable now.** Auto-email (the
   signing request + the signed copy) via **Resend** is an OPTIONAL, key-gated enhancement
   (`RESEND_API_KEY`; absent ⇒ copy-link only, never a hard failure), mirroring the Tracerfy gate in P5.
4. **Storage = Convex built-in `_storage`** (no Cloudflare R2 setup). The signed PDF is generated in
   the browser and uploaded to Convex storage.
5. **Both signing modes:** typed-name (validated against the expected signer name) AND drawn
   (`signature_pad`), per the BlueRock pattern.
6. **One combined spec, staged build** (offers → contracts data/generation → portal/e-sign → optional
   Resend). Built via the Opus-subagent TDD flow.

## Architecture (4 modules, all additive; `prclid` is the join key as everywhere in this CRM)

```
parcels (spine) ──< leadStatus (stage, buyerId, assignmentFee)   [exists]
    │
    ├──< offers (negotiation thread to the OWNER)                 [Module A — new]
    └──< contracts (psa | assignment, e-sign lifecycle)          [Module B/C — new]
                     │  PSA   ← lead(owner+property) + accepted offer(price/terms)
                     │  ASSIGN← lead + leadStatus.buyerId(buyer) + assignmentFee
                     └─ signed PDF in Convex _storage
buyers (cash-buyer CRM)                                           [exists — feeds Assignment]
/sign/$token  (public portal route, token-gated, NOT Clerk-authed)  [Module C — new]
```

---

## Module A — Offer tracking

### Data — `offers` table (index `by_prclid`)
```
prclid: string
amount: number               // offer price (to the owner)
status: "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired"
counterAmount?: number       // the owner's counter (when status === "countered")
earnestMoney?: number        // PSA-feeding terms
closingDate?: string         // ISO date string (display + PSA)
inspectionDays?: number
notes?: string
createdByEmail?: string      // stamped server-side from the caller (errorLogs precedent)
createdAt: number
updatedAt: number
```
One row per offer; a lead accumulates a thread. (No buyer-side "offer" — the assignment is a fee on
`leadStatus`, not a negotiation thread.)

### Pure logic — `src/scraper/offers.ts` (TDD)
- `OFFER_STATUSES` + `isOfferStatus(s)`.
- `canTransition(from, to)` — valid status moves (e.g. `pending → countered|accepted|rejected|withdrawn|expired`;
  terminal states `accepted|rejected|withdrawn|expired` don't transition further). Used to guard `updateOfferStatus`.
- `summarizeOffers(offers)` → `{ latest, activeCount, acceptedOffer | null, acceptedPrice | null }`
  (latest by createdAt; the accepted offer feeds the PSA). Imported by the UI and the contract builder.

### Convex — `convex/offerData.ts` (V8, shared-team `requireUser`)
- `offersForParcel(prclid)` query — newest-first.
- `addOffer({ prclid, amount, earnestMoney?, closingDate?, inspectionDays?, notes? })` mutation —
  inserts `pending`; `createdByEmail` from `getAuthUser` (server-side).
- `updateOfferStatus({ offerId, status, counterAmount? })` mutation — guarded by `canTransition`.
- `deleteOffer({ offerId })` mutation.
- internal `getAcceptedOfferInternal(prclid)` (for the contract action/builder).

### UI — `LeadOffers` panel in `/leads` expanded row (after `LeadContacts`)
Offer thread (amount, status badge, terms, who/when, newest-first); add-offer form; per-offer controls
(mark accepted / countered-with-amount / rejected / withdrawn). When an offer is `accepted`, the panel
shows a **"Generate purchase agreement"** affordance (Module B). Accepting an offer also surfaces a
**one-click "Move to under_contract"** suggestion (calls the existing pipeline stage mutation — NOT
forced; consistent with the manual stage select). Loads per-parcel on expand; the leads LIST query is untouched.

---

## Module B — Contracts: data model + template generation

### Data — `contracts` table (indexes `by_prclid`, `by_token`)
```
prclid: string
type: "psa" | "assignment"
status: "draft" | "sent" | "signed" | "declined" | "voided"
// Frozen snapshot of the terms at SEND time (so a later offer/lead edit can't mutate a sent contract):
terms: object {
  propertyAddress: string
  buyerEntity: string          // IRES legal name (config/default; editable)
  // PSA:
  sellerName?: string          // the owner (from contact/spine)
  price?: number               // from the accepted offer
  earnestMoney?: number
  closingDate?: string
  inspectionDays?: number
  // Assignment:
  assigneeName?: string        // the cash buyer (from buyers via leadStatus.buyerId)
  assignmentFee?: number       // from leadStatus.assignmentFee
  underlyingContractRef?: string  // human ref to the PSA (e.g. "PSA dated …")
}
signerName: string             // expected signer (seller or buyer name) — typed-mode match target
signerEmail?: string           // optional; only used by the Resend enhancement
signerRole: "seller" | "buyer"
publicToken: string            // 32-byte hex; the portal access credential
tokenCreatedAt: number
expiresAt: number              // tokenCreatedAt + 30 days
// Acceptance (ESIGN forensic trail):
acceptedAt?: number
acceptedByName?: string
acceptedUserAgent?: string
acknowledgments?: object { bindingContract: boolean }
signatureMode?: "typed" | "drawn"
signedStorageId?: id("_storage")
signedFilename?: string
// Decline:
declinedAt?: number
declineReason?: string
createdByEmail?: string
createdAt: number
updatedAt: number
```

### Pure logic — `src/scraper/contracts.ts` (TDD)
- `buildPsaTerms(lead, acceptedOffer, contact?, config)` → `terms` + `signerName`/`signerRole:"seller"`.
- `buildAssignmentTerms(lead, buyer, assignmentFee, config)` → `terms` + `signerName`/`signerRole:"buyer"`.
- `isSignerNameMatch(typed, expected)` — case-insensitive, trimmed, collapse-whitespace (ESIGN typed mode).
- `isTokenExpired(contract, now)`; `canAccept(contract)` (status `sent`, not expired, not already accepted).
- `CONTRACT_STATUSES` + transition guard `canContractTransition(from, to)`.
- `sanitizeFilename(name)` — strip to `[A-Za-z0-9._-]`, clamp ~120 chars (email/Content-Disposition defense, per BlueRock).

### Generation
A browser PDF component `src/web/contracts/ContractPDF.tsx` (`@react-pdf/renderer`) renders **PSA or
Assignment** from `terms` + the signature (drawn PNG data-URI OR typed italic name) + the acceptance
date. Standard sections (parties, property, price/fee + terms, signature block, the "not legal advice"
disclaimer). Copy `SignaturePad.tsx` + `trim-signature.ts` (+ test) from BlueRock verbatim.

---

## Module C — Signing portal + e-sign flow (serverless)

### Public route `/sign/$token` (NOT Clerk-authed — the token is the access credential)
Mounted OUTSIDE the authed `AppShell` (same way `/accept-invite` is public). Renders:
1. **Review:** an HTML rendering of the contract `terms` (readable in the portal). The authoritative
   signed **PDF** is generated on submit (step 3) and is downloadable afterward — so the portal review
   shows the same terms that get baked into the signed PDF (single source: the `terms` snapshot).
2. **Sign:** mode toggle typed ↔ drawn; an ESIGN consent checkbox ("I intend to sign and agree this
   is a legally binding electronic signature"); typed mode requires a name matching `signerName`.
3. **Submit:** the BROWSER generates the signed PDF (`ContractPDF` + signature) → uploads to Convex
   `_storage` via a token-gated upload URL → calls `acceptContract`. States: review → signed
   (download) / declined / expired / already-signed / void (404).

### Convex — `convex/contractData.ts` (V8)
Auth-gated (team, `requireUser`):
- `contractsForParcel(prclid)` query.
- `createContract({ prclid, type })` — builds `terms` (PSA from accepted offer; Assignment from
  `leadStatus.buyerId`+`assignmentFee`), `status:"draft"`, `signerName`/`signerRole`; rejects if the
  prerequisite is missing (PSA needs an accepted offer; Assignment needs an assigned buyer).
- `sendContract({ contractId, signerEmail? })` — mints `publicToken` (32-byte hex) + `expiresAt`,
  status → `sent`. (If `RESEND_API_KEY` set AND `signerEmail` given, schedules the optional email action.)
- `voidContract({ contractId })` — status → `voided` (invalidates the token).
- `getSignedUrl({ contractId })` — `ctx.storage.getUrl(signedStorageId)` for the team to download.

Public, **token-gated** (NO `requireUser`; the secret token is the credential — validate token +
expiry + state on every call):
- `getContractByToken({ token })` query — returns the contract `terms` + status for the portal (never
  leaks other parcels' data; returns a not-found shape for bad/expired/void tokens).
- `generateSignUploadUrl({ token })` mutation — validates `canAccept`, returns
  `ctx.storage.generateUploadUrl()`.
- `acceptContract({ token, signedStorageId, signatureMode, acceptedByName, acknowledgments, userAgent })`
  mutation — re-validates `canAccept`; on a typed signature enforces `isSignerNameMatch`; sets the
  acceptance forensic fields + `signedStorageId` + `signedFilename`; status → `signed`. Idempotent: a
  second submit on an already-signed contract returns `{ alreadySigned: true }` (two-tab safety).
- `declineContract({ token, reason? })` mutation — status → `declined`.

### Convex — `convex/contractActions.ts` (`"use node"`, OPTIONAL Resend, gated)
- `emailSigningRequest({ contractId })` + `emailSignedCopy({ contractId })` — both **no-op-with-log if
  `RESEND_API_KEY` is unset** (never throw into the UI). Use Resend HTTP API (works in V8), base64 the
  PDF bytes for the signed-copy attachment (drop the attachment + link instead if > ~36 MB, per BlueRock).
  `PORTAL_BASE_URL` env for the link. Explicit `Promise<...>` return type (TS7023).

### UI — `LeadContracts` panel in `/leads` expanded row (after `LeadOffers`)
- **"Generate PSA"** (enabled once an offer is `accepted`) and **"Generate Assignment"** (enabled once
  a buyer is assigned on `leadStatus`). Each → `createContract` (draft) → review → **"Send"** mints the
  token. Per-contract: status badge, **"Copy signing link"** (`{PORTAL_BASE_URL}/sign/{token}`), an
  optional "Email it" button (only when Resend is configured), **view/download signed PDF**, **Void**.
- "Signed by {name} on {date}" once signed; lucide icons only; same dark-theme vocabulary as the sibling panels.

---

## Dependencies
- **New npm:** `@react-pdf/renderer`, `pdf-lib`, `signature_pad` (all MIT; browser-side; no server).
- **Copied (MIT) from BlueRock:** `SignaturePad.tsx`, `trim-signature.ts` (+ test).
- **Convex env (optional, for the email enhancement only):** `RESEND_API_KEY`, `RESEND_FROM`,
  `PORTAL_BASE_URL`. Absent ⇒ copy-link-only; the build + the core sign flow do not depend on them.
- **No** R2, **no** Docker/server, **no** paid e-sign service.

## Security
- The portal mutations are **public but token-gated**: `publicToken` is unguessable 32-byte hex;
  every public fn re-validates token + `expiresAt` + status before acting. `getContractByToken` returns
  ONLY that contract's data. `voidContract`/re-send invalidates an old token.
- Upload is gated: `generateSignUploadUrl` only returns an upload URL for a valid, signable token.
- `acceptContract` re-checks `canAccept` (defends double-submit / race) and the typed-name match.
- Team functions keep `requireUser`; `createByEmail`/`acceptedByName` stamped/recorded, never trusted for authz.
- `sanitizeFilename` on the signed filename (email header / Content-Disposition defense).

## ESIGN / legal posture (informational, not legal advice)
Consent checkbox + intent, typed-name match OR drawn mark, and a forensic trail
(`acceptedAt`/`acceptedByName`/`acceptedUserAgent`/`acknowledgments`/`signatureMode`) satisfy the U.S.
ESIGN Act baseline for electronic signatures. **The generated PSA/Assignment templates are starting
points, NOT attorney-vetted documents** — every generated PDF and the portal carry a visible "not legal
advice — have your attorney review" disclaimer. Template wording is kept in one place for easy review/replacement.

## Testing & verification
- Vitest (pure, offline): `offers.ts` (transition guard, `summarizeOffers`), `contracts.ts`
  (`buildPsaTerms`/`buildAssignmentTerms`, `isSignerNameMatch`, `isTokenExpired`/`canAccept`,
  transition guard, `sanitizeFilename`). Fixtures from representative lead/offer/buyer shapes.
- `npx convex dev --once` + `npm run build` + full suite green after each task.
- Manual verification (no external account needed): create an offer → accept → Generate PSA → Send →
  copy link → open `/sign/$token` in a logged-out browser → review → sign (typed + drawn) → confirm
  the signed PDF stores + downloads in-app + status flips; decline + void + expiry paths; the
  Assignment path from an assigned buyer. The Resend enhancement is verified separately once a key is set.

## Deferred (documented, not built)
R2 storage migration · SMS delivery · multi-signer / counter-signature (IRES counter-signing) ·
audit-certificate PDF page · template editor UI (templates are code-level for v1) · reminders/expiry
cron · DocuSign/Documenso (explicitly not needed) · the buyer-blast disposition email (P8/end bucket).

## Untouched (additive guarantee)
The leads LIST query (offers/contracts load per-parcel on expand), Sheriff/Legal/Flip/Properties,
parcel seed/sync, signals, equity, P5 contacts. New tables + new files + two new `/leads` panels + one
new public route. The only shared-file edits: `convex/schema.ts` (two tables), `src/web/LeadsPage.tsx`
(two panels + render lines), the router (one public route), and `package.json` (three deps).
