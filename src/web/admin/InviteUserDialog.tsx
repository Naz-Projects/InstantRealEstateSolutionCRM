import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { UserPlus, Loader2, Check, Mail, X } from "lucide-react";
import { errMsg } from "./errMsg";

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
      setError(errMsg(err, "Failed to send invitation."));
    } finally {
      setSubmitting(false);
    }
  }

  const input = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg btn-metal-yellow px-3 py-2 text-sm font-semibold"
      >
        <UserPlus className="h-4 w-4" /> Invite user
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Invite user</h2>
              <button onClick={close} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            {sentTo ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm text-emerald-200">
                    <span className="inline-flex items-center gap-1 font-medium"><Check className="h-4 w-4" /> Invitation sent</span>
                    <div>We emailed an invite link to <span className="font-medium">{sentTo}</span>. They'll set a password and land in the CRM.</div>
                  </div>
                </div>
                <button onClick={close} className="w-full rounded-lg btn-metal-yellow px-4 py-2 text-sm font-semibold">Done</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={input} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={input} />
                  <p className="text-xs text-muted-foreground">Clerk emails the invite to this address.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")} className={input}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent">Cancel</button>
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg btn-metal-yellow px-4 py-2 text-sm font-semibold disabled:opacity-60">
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
