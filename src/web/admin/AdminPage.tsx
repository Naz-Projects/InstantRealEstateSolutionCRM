import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type ErrorLogRow = FunctionReturnType<typeof api.errors.listErrors>[number];
import { Loader2, Trash2, AlertTriangle, Bug } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InviteUserDialog } from "./InviteUserDialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { errMsg } from "./errMsg";

type Filter = "active" | "all" | "admin" | "member";
const FILTERS: Filter[] = ["active", "all", "admin", "member"];

function RoleSelect({ userId, role, isSelf }: { userId: Id<"users">; role: string; isSelf: boolean }) {
  const setUserRole = useMutation(api.users.setUserRole);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        value={role}
        disabled={saving || isSelf}
        onValueChange={async (next) => {
          if (next === role) return;
          setSaving(true); setSaveErr("");
          try { await setUserRole({ userId, role: next as "admin" | "member" }); } catch (err) { setSaveErr(errMsg(err, "Failed to change role")); } finally { setSaving(false); }
        }}
      >
        <SelectTrigger
          className="h-7 w-28 text-xs font-semibold capitalize"
          title={isSelf ? "Cannot change your own role" : "Change role"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="member">Member</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectContent>
      </Select>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {saveErr && <span className="text-xs text-red-400">{saveErr}</span>}
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
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${isActive ? "bg-teal" : "bg-muted"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isActive ? "left-4" : "left-0.5"}`} />
      </button>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {saveErr && <span className="text-xs text-red-400">{saveErr}</span>}
    </span>
  );
}

function DeleteUserButton({ userId, name, isSelf }: { userId: Id<"users">; name: string; isSelf: boolean }) {
  const deleteUser = useAction(api.users.deleteUser);
  const [open, setOpen] = useState(false);
  if (isSelf) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Remove user" className="text-muted-foreground hover:text-red-400">
        <Trash2 className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${name}?`}
        description="Deletes them from Clerk and the CRM. Consider deactivating instead."
        confirmLabel="Remove"
        destructive
        onConfirm={() => deleteUser({ userId })}
      />
    </>
  );
}

function UsersPanel({ meId }: { meId: Id<"users"> }) {
  const users = useQuery(api.users.listUsers);
  const [filter, setFilter] = useState<Filter>("active");
  const rows = (users ?? []).filter((u) => filter === "all" ? true : filter === "active" ? u.isActive : u.role === filter);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${filter === f ? "bg-teal/15 text-teal-glow shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <InviteUserDialog />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Active</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users === undefined && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading users…</td></tr>
            )}
            {users !== undefined && rows.map((u) => {
              const isSelf = u._id === meId;
              const pending = u.tokenIdentifier.startsWith("pending:");
              return (
                <tr key={u._id} className={`border-b border-border last:border-0 ${!u.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {u.name}{pending && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">PENDING</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3"><RoleSelect userId={u._id} role={u.role} isSelf={isSelf} /></td>
                  <td className="px-4 py-3"><ActiveToggle userId={u._id} isActive={u.isActive} isSelf={isSelf} /></td>
                  <td className="px-4 py-3"><DeleteUserButton userId={u._id} name={u.name} isSelf={isSelf} /></td>
                </tr>
              );
            })}
            {users !== undefined && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  error: "bg-red-500/15 text-red-400",
  warning: "bg-amber-500/15 text-amber-300",
};
const SOURCE_LABEL: Record<string, string> = {
  boundary: "Crash",
  uncaught: "Uncaught",
  handled: "Handled",
  server: "Backend",
};

function ErrorRow({ row }: { row: ErrorLogRow }) {
  const setResolved = useMutation(api.errors.setResolved);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detail = [row.context && `at ${row.context}`, row.route, row.userEmail].filter(Boolean).join(" · ");
  const tech = [row.stack, row.componentStack].filter(Boolean).join("\n\n");

  return (
    <tr className={`border-b border-border/60 last:border-0 align-top ${row.resolved ? "opacity-50" : ""}`}>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
        {new Date(row.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[row.severity] ?? "bg-muted text-muted-foreground"}`}>
          {row.severity}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{SOURCE_LABEL[row.source] ?? row.source}</td>
      <td className="px-4 py-3">
        <div className="text-sm text-foreground">{row.message}</div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
        {tech && (
          <>
            <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs text-teal-glow hover:underline">
              {expanded ? "Hide details" : "Show details"}
            </button>
            {expanded && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                {tech}
              </pre>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          disabled={busy}
          onClick={async () => { setBusy(true); try { await setResolved({ id: row._id, resolved: !row.resolved }); } finally { setBusy(false); } }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-teal hover:text-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {row.resolved ? "Reopen" : "Resolve"}
        </button>
      </td>
    </tr>
  );
}

function ErrorLogPanel() {
  const [onlyUnresolved, setOnlyUnresolved] = useState(true);
  const errors = useQuery(api.errors.listErrors, { onlyUnresolved });
  const clearResolved = useMutation(api.errors.clearResolved);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {[
            { key: true, label: "Unresolved" },
            { key: false, label: "All" },
          ].map((t) => (
            <button
              key={String(t.key)}
              onClick={() => setOnlyUnresolved(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${onlyUnresolved === t.key ? "bg-teal/15 text-teal-glow shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setConfirmClear(true)}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-red-500/50 hover:text-red-400"
        >
          Clear resolved
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">What happened</th>
              <th className="w-24 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {errors === undefined && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {errors !== undefined && errors.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                <Bug className="mx-auto mb-2 h-6 w-6 opacity-50" />
                {onlyUnresolved ? "No unresolved errors — all clear." : "No errors logged."}
              </td></tr>
            )}
            {errors?.map((row) => <ErrorRow key={row._id} row={row} />)}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear resolved errors?"
        description="Permanently deletes every error marked resolved. Unresolved errors are kept."
        confirmLabel="Clear resolved"
        destructive
        onConfirm={() => clearResolved({})}
      />
    </>
  );
}

export function AdminPage() {
  const me = useQuery(api.users.currentUser);
  const unresolved = useQuery(api.errors.unresolvedCount);
  const [tab, setTab] = useState<"users" | "errors">("users");

  if (me === undefined) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!me || me.role !== "admin") {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <p className="text-base font-medium text-foreground">Access denied</p>
          <p className="text-sm text-muted-foreground">The admin page is available to admins only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground">Admin</h1>
        <p className="text-sm text-muted-foreground">Manage team members and review system errors.</p>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("users")}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === "users" ? "border-teal text-teal-glow" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Users
        </button>
        <button
          onClick={() => setTab("errors")}
          className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === "errors" ? "border-teal text-teal-glow" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Error Log
          {!!unresolved && (
            <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">{unresolved}</span>
          )}
        </button>
      </div>

      {tab === "users" ? <UsersPanel meId={me._id} /> : <ErrorLogPanel />}
    </div>
  );
}
