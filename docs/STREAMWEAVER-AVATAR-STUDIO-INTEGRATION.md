# StreamWeaver Avatar Studio integration

## Routes and ownership

The same editor is served from `/avatar-studio` and `/apps/streamweaver/avatar-studio`. The StreamWeaver Persona page links to the app-relative route. Avatar media uploads are made into the current tenant's media store using the signed-in owner session; rigging jobs reject assets that belong to another tenant or user.

## 2D and 3D source selection

- 2D mode uploads an idle PNG/WebP and an optional mouth-open image, publishes them, and saves the resulting URLs to the tenant's StreamWeaver appearance settings.
- 3D mode accepts a single-file GLB. Imported animation clips can be exported together with the model before upload. The editor retains the orbit preview, embedded clip selector, shared motion retargeting, and local trigger-map editor. The free Quaternius Universal Animation Library Standard GLB is loaded on demand (CC0) and compatible clips are retargeted onto the selected body skeleton; imported and embedded clips share the same selector. Stream-cohost controls group clips into idle/seated/standing, social reactions, talking/listening and other motions, with one-click standing idle, seated idle, wave, cheer, laugh, thinking and talking actions. These are best-effort name matches: if the loaded pack has no compatible clip for an action, the editor reports that rather than pretending a missing action played. Face expression presets include smile, blink, surprise, laugh, cheer, delight, sadness, anger and thinking; live Audio2Face frames can still drive the face while body motion stays idle.
- The small model-fit controls adapt the ZIP's `TweakControls` state model. Non-default scale/offset changes are exported with the GLB; facial movement intensity is stored in tenant appearance settings.

## Direct GLB rigging (no photo round-trip)

The direct path reads the user-owned GLB from media storage and sends the job to the Fly worker. The Blender script imports that same GLB, preserves existing rig/animation/shape-key data where supported, adds or locates Head/Jaw/eye bones, assigns limited jaw weights within the head-height band, and exports the processed GLB back to media storage. The output becomes the active `modelUrl` and is announced through `streamweaver.avatar.updated.v1` and `streamweaver.avatar.model.updated.v1`.

The script does **not** render the model into turntable images and does **not** reconstruct a second head from photos. An unrigged head-only GLB can receive a basic Head/Jaw/eye armature; an already-rigged character uses its existing skeleton. Unrigged full-body meshes are rejected instead of being incorrectly weighted entirely to a head bone. Automatic jaw weighting is heuristic and may need Blender cleanup.

This stage retains existing morph targets but does not invent real ARKit facial deformation shapes. A model with matching morph targets receives the corresponding Audio2Face values; otherwise the adapter rotates a bone named Jaw when present.

## Runtime configuration

Avatar rigging is deliberately opt-in. Enable both `STREAMWEAVER_AVATAR_RIGGING_ENABLED=1` and `STREAMWEAVER_AVATAR_BUILD_ENABLED=1` only after the worker machine has Blender installed and `blender` (or `STREAMWEAVER_BLENDER_BINARY`) is executable. The default script path is `apps/streamweaver/scripts/avatar_geometry.py`. In the sandbox, `SPMT_AVATAR_AI_OUTBOUND_MODE=enabled` is also required. Do not enable the flags until the target runtime actually has Blender; otherwise the job will fail when invoking it.

## Audio2Face bridge

The Studio can save a credential-free `ws://` or `wss://` bridge URL. A separately running bridge must send JSON messages with either a `blendshapes` object keyed by morph-target name or numeric `jawOpen`/`mouthOpen` values from 0 to 1. The existing StreamWeaver browser source consumes those messages for the selected 2D or 3D avatar. The Studio reports received frame count and last-frame time to make live output observable. The `Send TTS test to Audio2Face bridge` button sends `{ type: "tts_test", text, requestId }`; the configured bridge must handle that request by synthesizing/obtaining the audio, feeding it to NVIDIA Audio2Face, and streaming returned blendshape frames back over the same WebSocket. The Studio does not include that backend bridge implementation or start NVIDIA Audio2Face itself, so this test requires a bridge that implements the documented request. The separate browser TTS visual smoke test animates the jaw locally but is explicitly **not** Audio2Face inference and does not send browser speech audio to the bridge.

## ZIP scope

The relevant model-tweak behavior was integrated into the existing StreamWeaver editor and persistent avatar flow. The ZIP's photo-to-mesh `FaceFromPhoto` scaffold was not wired into this path: its tessellation is marked as a placeholder, its generated ARKit position offsets are zero placeholders, and its higher-detail route explicitly falls back to the standard route. Reintroducing that pipeline would reproduce the unwanted model-to-photos-to-new-head round-trip. The ZIP's wallet/NFT/contract UI is also unrelated to the StreamWeaver avatar browser source and is not copied into the production app.
