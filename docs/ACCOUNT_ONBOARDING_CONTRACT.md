# SPMT Account Onboarding and Password Setup Contract

Status: approved Green behavior before user migration.

## One account as soon as identity enters the ecosystem

Any first-party app that has a valid SPMT tenant ID for a person must call the scoped account provisioning API. SPMT creates or reuses exactly one tenant owner, canonical user, workspace, and passwordless profile immediately. This is intentionally safe to do before the person ever visits spmt.live so XP, points, analytics, app history and later shared facts have a canonical user ID from the beginning.

The account is **passwordless**, never assigned a generated/default password. Its sign-in state is `setup-required`. Repeating provisioning for the same tenant is idempotent. Provider identities supplied by an app are linked to that same user. Conflicting tenant/provider ownership is rejected for migration review instead of silently merging identities.

## Public sign-in/setup choices

The sign-in experience presents exactly two public choices in this order.

### 1. Primary — SpaceMountain invite / first-time setup

The primary action sends the user to the configured SpaceMountain Discord welcome channel. The SpaceMountain Discord app owns the channel interaction and presentation, but SPMT owns identity state.

When the user presses the SpaceMountain welcome interaction:

1. Discord gives the SpaceMountain app the immutable Discord user ID and current display information from the interaction.
2. SpaceMountain calls SPMT with its scoped service identity and the tenant ID.
3. SPMT creates/reuses the passwordless account and links the verified Discord ID.
4. SPMT returns an embed contract:
   - `Welcome to SpaceMountain, <user>`
   - explanation that Discord is verified and Twitch will be linked next
   - `Link Twitch & finish setup` button.
5. That button enters a ticket-bound Twitch OAuth flow. Twitch is not exposed as a separate public recovery option.
6. SPMT validates OAuth state, obtains the immutable Twitch ID, and links it to the same SPMT user.
7. The user returns to the first-time setup page and sets their SPMT password.
8. The setup ticket is single-use and expires.

If a passwordless/app-owned account is entered on the normal sign-in form, SPMT returns `setup_required` and the client automatically opens this first-time setup experience. User-facing copy should say **first-time sign in**, **finish setup**, or **set up your SpaceMountain account**, not “account recovery.”

## 2. Secondary — existing SPMT member Discord DM reset

Below the primary choice, smaller copy reads approximately:

> Already an SPMT member? Send a password reset to my Discord DM.

SPMT looks up the immutable Discord ID already linked to the canonical user and sends a short-lived, one-time password setup link. It does **not** send a plaintext password. The public response is intentionally generic whether or not an account exists, preventing easy account enumeration.

The DM link first converts the token into an HttpOnly setup cookie and removes the token from normal page navigation. The user then chooses a new password. Reset tickets are single-use and expire.

## Removed public recovery choice

Standalone Twitch recovery is not a third public option. Twitch verification still exists as a protected internal step inside the primary SpaceMountain setup flow. This prevents the old UI from presenting multiple overlapping identity-recovery mechanisms.

## App integration rule

Nebula Arcade, Discord Stream Hub, StreamWeaver, HearMeOut, SpaceMountain, Companion, and future first-party apps must provision identity whenever they have a valid tenant/user association. Nebula Arcade's internal games never provision under separate app identities. First-party apps use a scoped service identity with `identity:provision`; the SpaceMountain welcome interaction additionally uses `identity:onboard`.

No product app owns a second account database, generated default password, provider-token shortcut, or local recovery implementation.
