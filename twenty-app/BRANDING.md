# IRES Branding

**Instant Real Estate Solution** — wholesaling / flipping / buy-and-rent. Professional,
trustworthy, data-dense but clean.

## Tokens
| Token | Hex | Use |
|---|---|---|
| Navy (primary) | `#0B2545` | logo bg, headers, primary text |
| Navy 2 | `#13315C` | gradients, hover |
| Emerald (accent) | `#16A34A` | "instant" accent, success, CTAs |
| Ink | `#1A202C` | body text |
| Slate | `#64748B` | secondary text |
| Surface | `#F7FAFC` | table row striping |

Logo assets: `public/logo.svg` (square app icon) and `public/wordmark.svg` (horizontal lockup).

## Where branding applies in Twenty
- **App listing / marketplace:** `logoUrl: "logo.svg"` in `application-config.ts` (done).
- **Front components:** use the IRES palette inline; reference the logo via
  `getPublicAssetUrl("wordmark.svg")` in any widget/side-panel component.
- **Workspace branding (logo + name + theme):** set once in Twenty **Settings → Workspace**
  (upload `wordmark.svg`, set name to "Instant Real Estate Solution", pick the light/dark theme).
  This is an admin UI action, not app code — do it after the workspace is up.
