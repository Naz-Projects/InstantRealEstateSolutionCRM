import React from "react";
import ReactDOM from "react-dom/client";
import {
  ConvexReactClient,
  Authenticated,
  Unauthenticated,
  AuthLoading,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, SignInButton, useAuth } from "@clerk/clerk-react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./app";
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
        <img src="/logo.svg" alt="IRES" className="h-12 w-12 rounded-xl" />
        <div className="text-center leading-tight">
          <div className="text-lg font-bold">Instant Real Estate Solution</div>
          <div className="text-xs font-semibold tracking-[0.2em] text-accent">CRM</div>
        </div>
        <SignInButton mode="modal">
          <button className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            Sign in
          </button>
        </SignInButton>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthLoading>
          <div className="grid min-h-screen place-items-center bg-ink text-white/60">
            Loading…
          </div>
        </AuthLoading>
        <Authenticated>
          <RouterProvider router={router} />
        </Authenticated>
        <Unauthenticated>
          <SignInGate />
        </Unauthenticated>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
);
