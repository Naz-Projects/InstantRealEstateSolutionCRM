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

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
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
                <button onClick={close} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Done</button>
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
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
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
