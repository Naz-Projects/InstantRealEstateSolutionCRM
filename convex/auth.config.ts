// Clerk ↔ Convex auth. Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment
// when you wire up Clerk. When it's unset (e.g. local dev before Clerk),
// no provider is configured and the IRES_DEV=1 bypass in helpers.ts applies.
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: domain ? [{ domain, applicationID: "convex" }] : [],
};
