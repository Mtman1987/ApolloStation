# Application and workspace surfaces

Shipyard, the launcher, app settings, and app counts list the five first-party
products: StreamWeaver, HearMeOut, Nebula Arcade, DiscordStreamHub, and Stellar
Core. Independently registered developer applications remain discoverable.
Internal service registrations stay available to the SDK and workers.

| Surface | Location |
| --- | --- |
| Commlink and Chat Gateway | Workspace Commlink; Gateway supplies its transport |
| Overlay Bay | Workspace embed and pop-out |
| Simulation Rooms | Workspace embed and pop-out |
| Mission Control | Authorized operations/Coder panel inside Stellar Core |
| Windows Companion | Download installer; runs on Windows |
| MountainView | Download APK; runs on Android |

Home uses the SPMT mark. Settings uses the cockpit/control-console choice from
the icon sheet, reusing the existing four themed mission-control artwork files.
All header and sidebar navigation uses the same icon mapping.

The clickable Workspace footer opens an expandable panel. Personal overlays
contains the saved group selector and a Show selected overlay switch; overlay
links, shared tools, and window appearance are grouped in accordions. The footer
itself keeps only Workspace, three slots, and window controls. Standalone app
footers use the same expandable arrangement. Empty, disabled, and unavailable
overlays return transparent documents with compatible CSP, and no selected scene
keeps the Personal frame hidden.

The footer pop-out (`/?surface=workspace-popout`) carries the three saved slots,
shared tools, selected Personal overlay group, and display switch. Service
iframes use `surface=workspace-service` and never initialize another dock.
Their frames remain mounted when switching tools. Footer Settings opens the
shared workspace settings within the same window.

`activePersonalOverlaySceneId` selects any saved named scene.
`personalOverlayEnabled` is the revisioned workspace display switch; it defaults
to enabled for existing workspaces. Neither changes Public output. Changes
require `workspace:write`. Personal output still requires `workspace:read` and
is tenant scoped. Other open surfaces follow changes within five seconds.
Device overlay hosting at `/workspace/overlay` follows the same authenticated
selection and switch. Compatibility discovery routes point existing companion
clients at those canonical surfaces; no session tokens enter launch URLs.

The download links use the existing released EXE and APK. This change does not
rebuild native installers or change an installed device's configured SPMT host.
A device must connect to the Apollo host being tested to consume these surfaces.

## Acceptance check

1. In Shipyard and the launcher, confirm only the five installed first-party
   products appear; Windows and Android appear below as download links.
2. Open Workspace from the footer. Open Commlink, Overlay Bay, and Settings;
   switch between them and confirm their content remains available.
3. Save two named scenes in Overlay Bay. Click Workspace and select one under Personal overlays, then switch to the other.
4. Pop out the workspace. Confirm the selected group and Overlay On/Off control
   are present. Toggle Off; confirm the Personal layer disappears in both
   windows within five seconds. Public output must stay unchanged.
5. Toggle On and change the group in the pop-out. Check another app and the
   authenticated device overlay host. Confirm an unauthorized browser cannot
   access Personal output.
6. In Stellar Core, open Mission Control as an authorized operator. Confirm
   operations and Coder remain absent for a user without those permissions.
7. Check Home and Settings in all four themes and on a narrow screen.

Validation: TypeScript build; affected shell, ingress, overlay, authority,
companion and product-surface tests; DOM interaction checks for tool switching,
selection persistence, display toggle, popup URL and prevention of nested docks.
The cloud browser could not reach the local preview, so rendered browser and
physical Windows/Android acceptance remain to be checked on the target host.

Main pushes again trigger the existing protected release Sprite promotion after
the owner authorized deployment on 2026-09-06. The repository opt-in variable,
environment gate, target identity checks, full tests, atomic switch, and rollback
remain in place. The release Sprite is web-terminal-bvesa.sprites.app.

Sprite setup provisions FFmpeg 6.1.1 from a pinned, SHA-256-verified static
release before media tests, and launches workers with that same executable on
PATH. Release verification checks the live shell bytes, all four Home/Settings
icon pairs, native download redirects, and app build identities.
