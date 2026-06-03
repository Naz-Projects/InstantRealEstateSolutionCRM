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
import { errMsg } from "./admin/errMsg";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function SignInGate() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink text-white">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white/5 px-10 py-12 ring-1 ring-white/10">
        <img
          src="/ires-logo-onnavy.png"
          alt="Instant Real Estate Solution"
          className="h-16 w-auto object-contain"
        />
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">CRM</div>
        <SignInButton mode="modal">
          <button className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90">
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
    return <div className="grid min-h-screen place-items-center bg-ink text-white/60">Signing in…</div>;
  }
  if (typeof state === "object") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink text-white">
        <div className="max-w-sm rounded-2xl bg-white/5 px-8 py-10 text-center ring-1 ring-white/10">
          <div className="text-base font-semibold">Access unavailable</div>
          <p className="mt-2 text-sm text-white/70">{state.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <RouterProvider router={router} />;
}

const onAcceptInvite = window.location.pathname.startsWith("/accept-invite");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthLoading>
          <div className="grid min-h-screen place-items-center bg-ink text-white/60">Loading…</div>
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
