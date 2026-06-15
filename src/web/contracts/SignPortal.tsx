import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { pdf } from "@react-pdf/renderer";
import {
  Loader2,
  ShieldCheck,
  Pencil,
  Keyboard,
  CheckCircle2,
  XCircle,
  Clock,
  FileWarning,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { ContractPDF } from "./ContractPDF";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";
import { describeError } from "../lib/errorReporting";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// PUBLIC token-gated e-sign portal. Mounted BEFORE the Clerk auth gate in
// main.tsx — an unauthenticated signer (property owner / cash buyer) opens
// /sign/<token>, reviews the contract, and signs. Every Convex call here is a
// PUBLIC fn gated solely by the secret token (no requireUser). Spec:
// 2026-06-14-offers-contracts-esign-design.md.

type SignMode = "typed" | "drawn";

function formatMoney(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return "";
  return "$" + amount.toLocaleString("en-US");
}

// Standalone dark-theme page shell, mirroring SignInGate / AcceptInvite.
function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10 text-white">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-2">
          <img
            src="/ires-logo-onnavy.png"
            alt="Instant Real Estate Solution"
            className="h-12 w-auto object-contain"
          />
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-primary">
            Document Signing
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// Centered single-message status card (loading / invalid / declined / expired).
function StatusCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      {icon}
      <div className="text-lg font-semibold text-white">{title}</div>
      {body && <p className="max-w-sm text-sm text-white/70">{body}</p>}
    </Card>
  );
}

export function SignPortal() {
  // Outside the TanStack router — read the token straight off the path.
  const token = window.location.pathname
    .replace(/^\/sign\//, "")
    .replace(/\/+$/, "");

  const contract = useQuery(api.contractData.getContractByToken, { token });
  const genUpload = useMutation(api.contractData.generateSignUploadUrl);
  const accept = useMutation(api.contractData.acceptContract);
  const decline = useMutation(api.contractData.declineContract);

  const [mode, setMode] = useState<SignMode>("typed");
  const [printName, setPrintName] = useState("");
  const [padEmpty, setPadEmpty] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "signing" | "uploading" | "saving">("idle");
  const [declining, setDeclining] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  // --- Non-signable states -------------------------------------------------
  if (contract === undefined) {
    return (
      <PortalShell>
        <StatusCard
          icon={<Loader2 className="h-8 w-8 animate-spin text-teal-glow" />}
          title="Loading…"
        />
      </PortalShell>
    );
  }

  if (!contract.found) {
    return (
      <PortalShell>
        <StatusCard
          icon={<FileWarning className="h-8 w-8 text-white/50" />}
          title="Signing link not active"
          body="This signing link is invalid or no longer active."
        />
      </PortalShell>
    );
  }

  if (contract.signed || contract.acceptedAt) {
    return (
      <PortalShell>
        <StatusCard
          icon={<CheckCircle2 className="h-8 w-8 text-teal-glow" />}
          title="Signed — thank you."
          body="Your signed copy has been recorded. You may close this window."
        />
      </PortalShell>
    );
  }

  if (contract.status === "declined") {
    return (
      <PortalShell>
        <StatusCard
          icon={<XCircle className="h-8 w-8 text-white/50" />}
          title="Contract declined"
          body="This contract was declined."
        />
      </PortalShell>
    );
  }

  if (contract.status === "sent" && Date.now() > contract.expiresAt) {
    return (
      <PortalShell>
        <StatusCard
          icon={<Clock className="h-8 w-8 text-white/50" />}
          title="Signing link expired"
          body="This signing link has expired. Please contact us for a new link."
        />
      </PortalShell>
    );
  }

  // --- Review + sign UI ----------------------------------------------------
  // Capture narrowed locals: control-flow narrowing of `contract` does not
  // carry into the async closures below, so destructure here (after the
  // early returns) and reference these throughout.
  const { type, terms, signerName, signerRole } = contract;
  const isPsa = type === "psa";
  const docTitle = isPsa ? "Purchase & Sale Agreement" : "Assignment of Contract";

  const trimmedName = printName.trim();
  const methodReady = mode === "typed" ? trimmedName.length > 0 : !padEmpty;
  const canSign = consent && methodReady && !busy && !declining;

  async function handleSign() {
    setErr(null);
    setBusy(true);
    try {
      // 1. Resolve the drawn signature (if any).
      let signatureDataUri: string | null = null;
      if (mode === "drawn") {
        signatureDataUri = padRef.current?.exportTrimmedPng() ?? null;
        if (!signatureDataUri) {
          setErr("Please draw your signature");
          setBusy(false);
          return;
        }
      }

      // 2. Generate the signed PDF in-browser.
      setStage("signing");
      const blob = await pdf(
        <ContractPDF
          type={type}
          terms={terms}
          signerRole={signerRole}
          signatureDataUri={signatureDataUri}
          typedName={mode === "typed" ? printName : printName}
          acceptedDate={new Date().toLocaleDateString()}
        />,
      ).toBlob();

      // 3. Get a one-time upload URL (token-gated).
      setStage("uploading");
      const uploadUrl = await genUpload({ token });

      // 4. Upload the PDF to Convex storage.
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: blob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json();

      // 5. Record acceptance (server re-validates token + typed-name match).
      setStage("saving");
      await accept({
        token,
        signedStorageId: storageId,
        signatureMode: mode,
        acceptedByName: printName,
        acknowledgments: { bindingContract: true },
        userAgent: navigator.userAgent,
      });

      // 6. Success — the reactive getContractByToken will flip to signed and
      //    re-render the thank-you view. Keep the busy state until it does.
    } catch (e) {
      setErr(describeError(e).message);
      setBusy(false);
      setStage("idle");
    }
  }

  async function handleDecline() {
    setErr(null);
    setDeclining(true);
    try {
      await decline({ token });
      // Reactive query flips status -> "declined" and re-renders.
    } catch (e) {
      setErr(describeError(e).message);
      setDeclining(false);
    }
  }

  const signLabel = (() => {
    if (!busy) return "Sign";
    if (stage === "signing") return "Preparing document…";
    if (stage === "uploading") return "Uploading…";
    if (stage === "saving") return "Finalizing…";
    return "Working…";
  })();

  return (
    <PortalShell>
      {/* Contract review */}
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">{docTitle}</h1>
          <p className="text-sm text-white/60">Please review the terms below before signing.</p>
        </div>

        {/* Parties */}
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-teal-glow">Parties</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[0.7rem] uppercase tracking-wide text-white/40">
                {isPsa ? "Buyer" : "Assignor"}
              </div>
              <div className="text-sm text-white/90">{terms.buyerEntity}</div>
            </div>
            <div>
              <div className="text-[0.7rem] uppercase tracking-wide text-white/40">
                {isPsa ? "Seller" : "Assignee"}
              </div>
              <div className="text-sm text-white/90">
                {isPsa ? terms.sellerName ?? "" : terms.assigneeName ?? ""}
              </div>
            </div>
          </div>
        </section>

        {/* Property */}
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-teal-glow">Property</h2>
          <div className="text-sm text-white/90">{terms.propertyAddress}</div>
        </section>

        {/* Terms */}
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-teal-glow">Terms</h2>
          <dl className="space-y-1 text-sm">
            {isPsa ? (
              <>
                {terms.price !== undefined && (
                  <TermRow label="Purchase Price" value={formatMoney(terms.price)} />
                )}
                {terms.earnestMoney !== undefined && (
                  <TermRow label="Earnest Money" value={formatMoney(terms.earnestMoney)} />
                )}
                {terms.closingDate !== undefined && (
                  <TermRow label="Closing Date" value={terms.closingDate} />
                )}
                {terms.inspectionDays !== undefined && (
                  <TermRow label="Inspection Period" value={`${terms.inspectionDays} days`} />
                )}
              </>
            ) : (
              <>
                {terms.underlyingContractRef !== undefined && (
                  <TermRow label="Underlying Agreement" value={terms.underlyingContractRef} />
                )}
                {terms.assignmentFee !== undefined && (
                  <TermRow label="Assignment Fee" value={formatMoney(terms.assignmentFee)} />
                )}
              </>
            )}
          </dl>
        </section>

        <p className="border-t border-white/10 pt-3 text-xs leading-relaxed text-white/40">
          This document is a generated template provided for convenience and is NOT legal advice.
          Consult an attorney before signing.
        </p>
      </Card>

      {/* Sign block */}
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Sign this contract</h2>
        </div>

        {/* ESIGN consent disclosure */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/70">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-teal-glow" />
            Electronic signature consent
          </div>
          <p>
            By {mode === "typed" ? "typing your full name" : "drawing your signature"} and clicking{" "}
            <strong>Sign</strong>, you are providing your electronic signature. Under the U.S.
            Electronic Signatures in Global and National Commerce Act (ESIGN), this signature has
            the same legal effect as a handwritten signature.
          </p>
        </div>

        {/* Print name */}
        <div className="space-y-1.5">
          <label htmlFor="printName" className="text-sm font-medium text-white/90">
            Print your full name
          </label>
          <Input
            id="printName"
            type="text"
            value={printName}
            onChange={(e) => setPrintName(e.target.value)}
            placeholder={signerName}
            autoComplete="name"
            disabled={busy || declining}
          />
        </div>

        {/* Mode toggle */}
        <div className="space-y-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setMode("typed")}
              disabled={busy || declining}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === "typed" ? "bg-white/10 text-teal-glow" : "text-white/60 hover:text-white"
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Typed
            </button>
            <button
              type="button"
              onClick={() => setMode("drawn")}
              disabled={busy || declining}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === "drawn" ? "bg-white/10 text-teal-glow" : "text-white/60 hover:text-white"
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Drawn
            </button>
          </div>

          {mode === "typed" ? (
            <p className="text-xs text-white/50">
              Your typed name must match {signerName}.
            </p>
          ) : (
            <SignaturePad ref={padRef} onChange={setPadEmpty} />
          )}
        </div>

        {/* Consent checkbox */}
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy || declining}
            className="mt-0.5 h-4 w-4 cursor-pointer disabled:opacity-50"
            style={{ accentColor: "var(--color-teal)" }}
          />
          <span className="text-white/80">
            I intend to sign and agree this is a legally binding electronic signature.
          </span>
        </label>

        {err && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
          >
            {err}
          </div>
        )}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row">
          <Button
            type="button"
            disabled={!canSign}
            onClick={handleSign}
            className="btn-metal-yellow h-11 flex-1 text-base font-semibold disabled:opacity-50"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {signLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDecline}
            disabled={busy || declining}
            className="h-11 text-base"
          >
            {declining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Decline
          </Button>
        </div>
      </Card>
    </PortalShell>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-white/50">{label}:</dt>
      <dd className="text-white/90">{value}</dd>
    </div>
  );
}
