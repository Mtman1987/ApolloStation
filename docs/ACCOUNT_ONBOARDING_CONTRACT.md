# Apollo Account Onboarding and Password Setup Contract

Status: approved production behavior.

## One canonical account as soon as identity enters the ecosystem

Any first-party app that has a valid SPMT tenant ID for a person must call the scoped account provisioning API. SPMT creates or reuses exactly one tenant owner, canonical user, workspace, and passwordless profile immediately. This is safe to do before the person visits SpaceMountain so XP, points, analytics, app history, and later shared facts have a canonical user ID from the beginning.

The account is **passwordless**, never assigned a generated/default password. Its sign-in state is `setup-required`. Repeating provisioning for the same tenant is idempotent. Provider identities supplied by an app are linked to that same user. Conflicting tenant/provider ownership is rejected for migration review instead of silently merging identities.

## First-time setup for a passwordless account

The SpaceMountain Discord welcome interaction remains the primary first-time enrollment path. The SpaceMountain Discord app owns the channel interaction and presentation; SPMT owns identity state.

1. Discord supplies the immutable Discord user ID and current display information from the interaction.
2. SpaceMountain calls SPMT with its scoped service identity and tenant ID.
3. SPMT creates/reuses the passwordless account and links the verified Discord ID.
4. SPMT returns the welcome embed and a `Link Twitch & finish setup` action.
5. That action enters a ticket-bound Twitch OAuth flow.
6. SPMT validates OAuth state, obtains the immutable Twitch ID, and links it to the same SPMT user.
7. The user returns to first-time setup and sets a password.
8. The first-time setup ticket is single-use and expires.

If a passwordless/app-owned account is entered on the normal sign-in form, SPMT returns `setup_required` and the client opens the first-time setup experience. User-facing copy should say **first-time sign in**, **finish setup**, or **set up your SpaceMountain account** for this enrollment path.

## Existing-account recovery — already-linked Discord or Twitch

The Apollo login screen exposes **Recover / Set Password**. This is the supported recovery flow for an existing Apollo account whose password is missing or needs to be replaced.

1. The user enters their existing Apollo username and chooses **Verify with Discord** or **Verify with Twitch**.
2. SPMT starts the provider's normal OAuth authorization-code flow using the existing provider client configuration and the registered Node 1 callback origin. The pending provider, username, and random OAuth state are held in a short-lived HttpOnly, Secure, SameSite cookie.
3. The callback validates the state against that browser cookie before exchanging the authorization code. It obtains the provider's immutable user ID from Discord `/users/@me` or Twitch `/helix/users`.
4. Account recovery core requires that exact provider ID to already be linked, active, and owned by the Apollo user identified by the supplied username. Display names and provider usernames are never used as identity keys.
5. SPMT issues a provider-specific, state-bound, hashed, 15-minute, single-use password-reset ticket. The raw ticket stays in an HttpOnly browser cookie; it is not placed in the URL.
6. Before changing the password, the core rechecks that the provider link is still active and still belongs to the same user. It consumes the ticket atomically, then uses the existing Apollo password hashing and policy.
7. The service performs a normal Apollo credential login, issues the standard HttpOnly browser session cookie, and the client loads the SpaceMountain shell automatically.

Recovery must **not** create an account, grandfather an identity, relink a provider, restore a revoked link, merge accounts, or change tenant ownership. A username/provider mismatch, revoked link, invalid OAuth state, expired ticket, or replay fails closed. Public failure messages do not reveal whether a username or provider link exists.

Discord and Twitch are equal, independent verification choices for recovery. The user only needs to prove control of one provider identity that is already linked to that Apollo account.

## Public recovery UX and compatibility

- The Apollo login screen presents the normal username/password sign-in and the **Recover / Set Password** path.
- Recovery asks for the Apollo username before starting either provider flow.
- The recovery password form appears only after successful OAuth verification and requires password confirmation.
- Successful password setting establishes the normal Apollo browser session and opens the app without a second manual login.
- The old Discord DM-reset experience is **not** the public recovery UX and must not be wired into this flow. Any retained legacy endpoint is compatibility-only; the login UI and new recovery client must not call it.

## App integration rule

Nebula Arcade, Discord Stream Hub, StreamWeaver, HearMeOut, SpaceMountain, Companion, and future first-party apps must provision identity whenever they have a valid tenant/user association. Nebula Arcade's internal games never provision under separate app identities. First-party apps use a scoped service identity with `identity:provision`; the SpaceMountain welcome interaction additionally uses `identity:onboard`.

No product app owns a second account database, generated default password, provider-token shortcut, or local recovery implementation.
