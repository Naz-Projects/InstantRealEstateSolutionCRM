import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Loader2, Trash2, ShieldAlert } from "lucide-react";
import { InviteUserDialog } from "./InviteUserDialog";
import { errMsg } from "./errMsg";

type Filter = "active" | "all" | "admin" | "member";
const FILTERS: Filter[] = ["active", "all", "admin", "member"];

function RoleSelect({ userId, role, isSelf }: { userId: Id<"users">; role: string; isSelf: boolean }) {
  const setUserRole = useMutation(api.users.setUserRole);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={role}
        disabled={saving || isSelf}
        title={isSelf ? "Cannot change your own role" : "Change role"}
        onChange={async (e) => {
          const next = e.target.value as "admin" | "member";
          if (next === role) return;
          setSaving(true); setSaveErr("");
          try { await setUserRole({ userId, role: next }); } catch (err) { setSaveErr(errMsg(err, "Failed to change role")); } finally { setSaving(false); }
        }}
        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-semibold capitalize disabled:opacity-60"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      {saveErr && <span className="text-xs text-red-600">{saveErr}</span>}
    </span>
  );
}

function ActiveToggle({ userId, isActive, isSelf }: { userId: Id<"users">; isActive: boolean; isSelf: boolean }) {
  const setActive = useAction(api.users.setActive);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        role="switch"
        aria-checked={isActive}
        aria-label={isActive ? "Deactivate user" : "Activate user"}
        disabled={saving || isSelf}
        title={isSelf ? "Cannot change your own status" : isActive ? "Deactivate" : "Activate"}
        onClick={async () => { setSaving(true); setSaveErr(""); try { await setActive({ userId, isActive: !isActive }); } catch (err) { setSaveErr(errMsg(err, "Failed to update status")); } finally { setSaving(false); } }}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${isActive ? "bg-accent" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isActive ? "left-4" : "left-0.5"}`} />
      </button>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      {saveErr && <span className="text-xs text-red-600">{saveErr}</span>}
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
                onClick={async () => { setBusy(true); setErr(""); try { await deleteUser({ userId }); setConfirming(false); } catch (e) { setErr(errMsg(e, "Delete failed")); } finally { setBusy(false); } }}
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
