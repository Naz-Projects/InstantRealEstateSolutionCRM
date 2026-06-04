import { Component, type ErrorInfo, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { reportBoundaryError, FRIENDLY_ERROR } from "./lib/errorReporting";

type Props = {
  children: ReactNode;
  onError: (error: Error, componentStack?: string) => void;
};
type State = { error: Error | null; ref: string };

// Class boundary — only class components can catch render errors. It reports via
// the injected `onError` (the wrapper owns the Convex mutation hook) and shows a
// branded "contact your administrator" card instead of a blank white screen.
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, ref: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Short, human-quotable reference the admin can match against the Error Log.
    return { error, ref: Date.now().toString(36).toUpperCase().slice(-6) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-background p-4 text-white">
        <div className="max-w-md rounded-2xl bg-white/5 px-8 py-10 text-center ring-1 ring-white/10">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-500/15">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <div className="text-base font-semibold">Something went wrong</div>
          <p className="mt-2 text-sm text-white/70">{FRIENDLY_ERROR}</p>
          <p className="mt-3 text-xs text-white/40">
            Reference: <span className="font-mono text-white/60">{this.state.ref}</span>
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg btn-metal-yellow px-4 py-2 text-sm font-semibold"
          >
            <RotateCw className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>
    );
  }
}

// Wrapper that owns the logging mutation (hooks can't live in the class) and feeds
// it to the boundary. Mount around the authed app.
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const logError = useMutation(api.errors.logError);
  return (
    <ErrorBoundaryInner
      onError={(error, componentStack) => reportBoundaryError(logError, error, componentStack)}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
