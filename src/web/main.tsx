import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ConvexReactClient,
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, SignInButton, useAuth } from "@clerk/clerk-react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { routeTree } from "./app";
import { AcceptInvite } from "./admin/AcceptInvite";
import { AppErrorBoundary } from "./ErrorBoundary";
import { errMsg } from "./admin/errMsg";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

// Last-resort global logger: anything that escapes a try/catch or an unhandled
// promise rejection still lands on the Admin → Error Log. Best-effort and
// loop-proof (the .catch swallows logging failures); transient browser/library
// noise is filtered and identical errors are de-duped within a short window.
const IGNORE_ERROR =
  /ResizeObserver|AbortError|Load failed|Failed to fetch|NetworkError|Non-Error promise rejection/i;
let lastKey = "";
let lastAt = 0;
function logUncaught(message: string, stack: string | undefined, context: string) {
  if (!message || IGNORE_ERROR.test(message)) return;
  const now = Date.now();
  const key = context + ":" + message;
  if (key === lastKey && now - lastAt < 10000) return; // de-dupe storms
  lastKey = key;
  lastAt = now;
  void convex
    .mutation(api.errors.logError, {
      message: message.slice(0, 2000),
      source: "uncaught" as const,
      context,
      route: window.location.pathname,
      stack: stack?.slice(0, 4000),
      userAgent: navigator.userAgent,
    })
    .catch(() => {});
}
window.addEventListener("error", (e) => {
  logUncaught(e.message || String(e.error ?? ""), (e.error as Error | undefined)?.stack, "window.error");
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { data?: { message?: string }; message?: string; stack?: string } | undefined;
  const msg = r?.data?.message || r?.message || String(r ?? "");
  logUncaught(msg, r?.stack, "unhandledrejection");
});

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function SignInGate() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-white">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white/5 px-10 py-12 ring-1 ring-white/10">
        <img
          src="/ires-logo-onnavy.png"
          alt="Instant Real Estate Solution"
          className="h-16 w-auto object-contain"
        />
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">CRM</div>
        <SignInButton mode="modal">
          <button className="rounded-lg btn-metal-yellow px-6 py-2.5 text-sm font-semibold">
            Sign in
          </button>
        </SignInButton>
      </div>
    </div>
  );
}

function AuthedApp() {
  const link = useMutation(api.users.linkOrRejectUser);
  const [state, setState] = useState<"linking" | "ok" | { error: string }>("linking");
  useEffect(() => {
    let cancelled = false;
    link({})
      .then(() => { if (!cancelled) setState("ok"); })
      .catch((e: unknown) => { if (!cancelled) setState({ error: errMsg(e, "Sign-in failed") }); });
    return () => { cancelled = true; };
  }, [link]);

  if (state === "linking") {
    return <div className="grid min-h-screen place-items-center bg-background text-white/60">Signing in…</div>;
  }
  if (typeof state === "object") {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-white">
        <div className="max-w-sm rounded-2xl bg-white/5 px-8 py-10 text-center ring-1 ring-white/10">
          <div className="text-base font-semibold">Access unavailable</div>
          <p className="mt-2 text-sm text-white/70">{state.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg btn-metal-yellow px-4 py-2 text-sm font-semibold"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  );
}

const onAcceptInvite = window.location.pathname.startsWith("/accept-invite");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthLoading>
          <div className="grid min-h-screen place-items-center bg-background text-white/60">Loading…</div>
        </AuthLoading>
        <Authenticated>
          <AuthedApp />
        </Authenticated>
        <Unauthenticated>
          {onAcceptInvite ? <AcceptInvite /> : <SignInGate />}
        </Unauthenticated>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
);
