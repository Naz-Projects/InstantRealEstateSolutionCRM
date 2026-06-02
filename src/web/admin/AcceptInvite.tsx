import { SignUp } from "@clerk/clerk-react";

// Public landing for Clerk invitation links. <SignUp> reads __clerk_ticket from
// the URL; after the user sets a password it establishes a session and
// <Authenticated> takes over. routing="virtual" keeps it self-contained.
export function AcceptInvite() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink">
      <SignUp routing="virtual" />
    </div>
  );
}
