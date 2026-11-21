# Apollo Bulletin — Personal Overlay Bay preset

Apollo Bulletin is a preset inside the existing SpaceMountain Overlay Bay editor. It is not a second workspace or a standalone task dashboard.

## Use it

1. Open Apollo Workspace → Overlay Bay.
2. Select **Personal** output.
3. Choose **Personal Bulletin** in the editor header. This creates a saved Personal Bulletin scene and selects it for the Personal output.
4. The initial scene stays mostly open: it places small frames for installed Mission Control, StreamWeaver, and Discord Stream Hub apps when those apps are available, plus a Task Queue component.
5. Add other sources from the existing app-frame list or the **Bulletin components** list, then move, resize, layer, lock, hide, duplicate, remove, and save them using the normal Overlay Bay editor.

The preset uses the existing revision-aware workspace scene persistence and Personal overlay output.

## Reusable Bulletin components

The editor exposes these widget sources under **Bulletin components**:

- Task Queue — create tasks and inspect/pause/resume/complete them.
- Active Task — current dispatching, dispatched, and review-waiting work.
- Review Requests — work waiting for explicit owner review.
- Activity Log — recent task lifecycle events.
- Scheduler — scheduled tasks and next run times.
- Task History — completed and uncertain/failed dispatches.

Each component is a normal Overlay Bay widget source with its own renderer URL and saved geometry. The task data remains in the Bulletin service; the scene stores only component configuration and layout.

Installed app frames are populated from the existing SpaceMountain app registry and use each app's registered launch URL. The task component renderer URLs are served from /bulletin/widgets/<component> and use the existing /bulletin/api/tasks service routes. /bulletin itself is only a small handoff page, not the primary dashboard.

## Hostless

Node 1 starts the Bulletin API/renderer on loopback port 3210. SpaceMountain's existing integrated server proxies /bulletin/* to that service. The Personal Overlay output embeds the widget renderers through the existing SPMT output gateway.

Set APOLLO_BULLETIN_PUBLIC_URL to the public Node 1 origin if it differs from the current default. Set APOLLO_BULLETIN_STATE_PATH to a persistent Hostless volume path; the fallback /tmp/apollo-bulletin/state.json is not durable across container replacement.

## Deliberate prototype boundary

- The scheduler persists dispatch intent before invoking its adapter and never automatically resends an uncertain dispatch.
- The ChatGPT browser adapter is still a stub (browser-adapter-not-connected). This PR does not claim that scheduled prompts are actually sent to ChatGPT.
- The existing repo documents the Apollo-native terminal backend as unfinished. No fake terminal frame or second terminal backend is introduced; the existing Mission Control/operations app frame is reusable, but a real terminal panel still needs the missing backend.
- The open task review URL and task API remain private-development prototype surfaces and require hardening before public exposure.
- No AI response monitoring, response parsing, or automatic continuation loop is implemented.
