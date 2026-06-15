"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// P6 OPTIONAL e-sign email via Resend. Gated on RESEND_API_KEY — no-op (logged) when unset.
// The copy-link flow works without this. Spec: 2026-06-14-offers-contracts-esign-design.md.

const RESEND_URL = "https://api.resend.com/emails";
type EmailResult = { sent: boolean; reason?: string };

async function sendResend(payload: Record<string, unknown>): Promise<void> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.RESEND_FROM ?? "").trim();
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...payload }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** Email the signing-request link to the signer. No-op if no key / no signerEmail. */
export const emailSigningRequest = internalAction({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<EmailResult> => {
    const key = (process.env.RESEND_API_KEY ?? "").trim();
    if (!key) return { sent: false, reason: "no RESEND_API_KEY" };
    const c = await ctx.runQuery(internal.contractData.getContractInternal, { contractId });
    if (!c || !c.signerEmail || !c.publicToken) return { sent: false, reason: "no signerEmail/token" };
    const base = (process.env.PORTAL_BASE_URL ?? "").trim() || "https://crm.instantrealestatesolution.com";
    const link = `${base}/sign/${c.publicToken}`;
    try {
      await sendResend({
        to: c.signerEmail,
        subject: `Please review and sign: ${c.type === "psa" ? "Purchase Agreement" : "Assignment of Contract"}`,
        text: `You have a document to review and sign for ${c.terms.propertyAddress}.\n\nReview and sign here: ${link}\n\nThis link expires in 30 days.`,
      });
      return { sent: true };
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `emailSigningRequest failed: ${(e as Error).message}`, context: "emailSigningRequest",
      });
      return { sent: false, reason: (e as Error).message };
    }
  },
});

/** Email the signed PDF to the team (and CC the signer if known). No-op without key. */
export const emailSignedCopy = internalAction({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<EmailResult> => {
    const key = (process.env.RESEND_API_KEY ?? "").trim();
    if (!key) return { sent: false, reason: "no RESEND_API_KEY" };
    const c = await ctx.runQuery(internal.contractData.getContractInternal, { contractId });
    if (!c || !c.signedStorageId) return { sent: false, reason: "no signed PDF" };
    const to = (process.env.RESEND_TO ?? process.env.RESEND_FROM ?? "").trim();
    if (!to) return { sent: false, reason: "no recipient" };
    try {
      const url = await ctx.storage.getUrl(c.signedStorageId);
      if (!url) return { sent: false, reason: "no storage url" };
      const bytes = await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer();
      const sizeMb = bytes.byteLength / (1024 * 1024);
      const base = (process.env.PORTAL_BASE_URL ?? "").trim() || "https://crm.instantrealestatesolution.com";
      const link = `${base}/sign/${c.publicToken}`;
      if (sizeMb > 36) {
        await sendResend({ to, ...(c.signerEmail ? { cc: c.signerEmail } : {}), subject: `Signed: ${c.terms.propertyAddress}`, text: `Signed contract is too large to attach. View: ${link}` });
        return { sent: true, reason: "link-only (too large)" };
      }
      const b64 = Buffer.from(bytes).toString("base64");
      await sendResend({
        to, ...(c.signerEmail ? { cc: c.signerEmail } : {}),
        subject: `Signed: ${c.terms.propertyAddress}`,
        text: `Signed by ${c.acceptedByName ?? "the signer"}. Copy attached.`,
        attachments: [{ filename: c.signedFilename ?? "signed-contract.pdf", content: b64 }],
      });
      return { sent: true };
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `emailSignedCopy failed: ${(e as Error).message}`, context: "emailSignedCopy",
      });
      return { sent: false, reason: (e as Error).message };
    }
  },
});
