import { useEffect, useState, type ReactNode } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeError } from "./lib/errorReporting";

// Branded confirmation modal — replaces native window.confirm app-wide. Generalizes
// the existing AdminPage delete-modal pattern (dark card overlay, lucide icon,
// branded buttons). Runs an async `onConfirm`, shows a spinner while it runs, and
// surfaces any failure inline (real wording via describeError) instead of closing.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  // Returns anything; the dialog awaits it and ignores the result.
  onConfirm: () => unknown | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset inline error each time the dialog opens; allow Escape to cancel.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onOpenChange]);

  if (!open) return null;

  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full",
              destructive ? "bg-red-500/15" : "bg-amber-500/15",
            )}
          >
            <AlertTriangle className={cn("h-5 w-5", destructive ? "text-red-400" : "text-amber-300")} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            disabled={busy}
            onClick={close}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (e) {
                setErr(describeError(e).message);
              } finally {
                setBusy(false);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60",
              destructive ? "bg-red-600 text-white hover:bg-red-700" : "btn-metal-yellow",
            )}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
