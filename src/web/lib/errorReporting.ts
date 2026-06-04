// Shared error surfacing + logging for the app.
//
// Two truths the user asked for:
//  1. Never show raw code/"Server Error" — show real human wording when we have it,
//     a friendly "contact your administrator" line otherwise.
//  2. Log it automatically to the Admin → Error Log page.
//
// Convex carries a function's intended user message at `err.data.message` and
// REDACTS a plain Error.message to "Server Error" in production — so we must read
// `data.message`, never `err.message`, for the user-facing string.

export const FRIENDLY_ERROR =
  "Something went wrong on our end. We've logged it for your administrators. Please try again — if it keeps happening, contact your administrator.";

export type DescribedError = { message: string; expected: boolean };

// Decide what to SHOW the user. `expected` = the backend sent an intended message
// (a ConvexError) we can safely display verbatim; otherwise use the friendly line.
export function describeError(e: unknown, fallback: string = FRIENDLY_ERROR): DescribedError {
  const data = (e as { data?: { message?: string } })?.data;
  if (data?.message) return { message: data.message, expected: true };
  return { message: fallback, expected: false };
}

// The technical detail we LOG for admins (real message + stack), even when the
// user only sees the friendly line.
function technicalMessage(e: unknown, shown: DescribedError): string {
  if (shown.expected) return shown.message;
  if (e instanceof Error && e.message) return e.message;
  return shown.message;
}

type LogErrorFn = (args: {
  message: string;
  source: "boundary" | "handled" | "uncaught" | "server";
  severity?: "error" | "warning";
  context?: string;
  route?: string;
  stack?: string;
  componentStack?: string;
  userAgent?: string;
}) => Promise<unknown>;

const route = () => (typeof window !== "undefined" ? window.location.pathname : undefined);
const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent : undefined);

// Handle a caught error from a user action: log it (fire-and-forget, never throws)
// and return the string to display. Pass `useMutation(api.errors.logError)` as `log`.
export function reportHandledError(log: LogErrorFn, e: unknown, context: string): string {
  const shown = describeError(e);
  try {
    void log({
      message: technicalMessage(e, shown),
      source: "handled",
      severity: shown.expected ? "warning" : "error",
      context,
      route: route(),
      stack: e instanceof Error ? e.stack : undefined,
      userAgent: ua(),
    }).catch(() => {});
  } catch {
    /* logging is best-effort — it must never break the action */
  }
  return shown.message;
}

// Log a render crash caught by the ErrorBoundary.
export function reportBoundaryError(log: LogErrorFn, e: unknown, componentStack?: string): void {
  try {
    void log({
      message: e instanceof Error ? e.message : String(e),
      source: "boundary",
      severity: "error",
      route: route(),
      stack: e instanceof Error ? e.stack : undefined,
      componentStack,
      userAgent: ua(),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}
