# Avatar Studio: current animation support and future FBX pack import

## Current implementation

The Avatar Studio is exposed at `/avatar-studio` and linked from Overlay Bay. It is a separate 3D preview room; it does not replace StreamWeaver's existing video-avatar flow.

Current local-preview capabilities:

- Upload a rigged GLB/GLTF avatar and play animation clips embedded in that model.
- Import a GLB/GLTF animation asset and retarget its clips onto the currently loaded avatar.
- Load the public three.ws canonical humanoid idle, walk, and wave clips, retargeting them to the active avatar when bone coverage passes the retargeter's 50% gate.
- Draft local trigger mappings for AI commands/speaking, Twitch events, channel points, chat commands, and manual playback.
- Hide the controls without unloading the avatar or stopping playback.
- Keep the nine supplied GIFs as visual references only; a GIF is not skeletal animation data.

Trigger mappings are currently an in-browser draft. They are not yet persisted and are not connected to live event ingestion. The 3D room has not been deployed or verified on a hosted Apollo instance.

## Deferred: import the user's 140-FBX animation pack

The source pack is currently a roughly 1.4 GB ZIP on the user's Android phone. It contains about 140 FBX files in nested folders, commonly grouped 40–50 files per folder. The ZIP has not been transferred or inspected, so filenames, rig conventions, clip counts, licensing terms, and compatibility remain unverified.

Do not add placeholder animation files or claim that the FBX pack is already integrated. Do not ask the user to upload the files individually.

When the archive becomes accessible to a build/processing environment:

1. Preserve the original ZIP and recursively inventory all nested paths.
2. Extract FBX files to a temporary workspace; record file name, path, size, and any import/parse errors.
3. Inspect animation tracks, skeleton/bone names, duration, frame rate where available, and duplicate clips. Group clips by source rig and detect files with no skeletal animation.
4. Batch-convert/retarget with a validated FBX-capable toolchain. The browser's current GLTFLoader does **not** load FBX directly, so don't simply add `.fbx` to the existing file input. Prefer producing compact canonical clip JSON or GLB outputs compatible with the existing runtime.
5. Generate a manifest with stable clip IDs, human-readable names, loop/one-shot classification, source path, conversion status, coverage diagnostics, and license/source notes.
6. Run representative idle, walk, wave, bow, dance, sit, confused, call, and combat clips against the target avatar before processing/deploying the full catalog.
7. Store processed outputs in an appropriate asset location and load them on demand; do not ship all 140 source FBXs or preload every converted clip into the initial page.
8. Add a catalog/search UI and map selected clips to triggers only after conversion results are validated. Keep mappings local until durable persistence and live event integration are implemented.

## Acceptance checks for the later pack import

- All nested FBX paths are discovered without flattening-name collisions.
- Every manifest entry reports success or an explicit reason for rejection.
- No clip is marked playable unless conversion succeeded and target-rig coverage passed.
- Representative motions play without T-pose, broken orientation, or severe hip drift.
- Initial Avatar Studio load does not download the entire library.
- The pack's usage/license terms are recorded before redistributing source or converted assets.
- Tests cover recursive discovery, duplicate IDs, conversion failures, manifest validation, on-demand loading, and fallback when a clip is incompatible.

## Known limitations to keep visible

- The existing GIF list is not playable motion data.
- The three.ws shared motion endpoint is an external dependency; for guaranteed availability, vendor validated clips with the app once license and repository size constraints are checked.
- Trigger source labels are UI configuration only until connected to actual event delivery.
- Model and animation uploads currently live in the browser session; they are not a persistent asset store.
- FBX pack import is intentionally deferred until the ZIP can be accessed. No hosting is assumed to exist today.
