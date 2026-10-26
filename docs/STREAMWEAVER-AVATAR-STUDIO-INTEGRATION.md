# StreamWeaver Avatar Studio integration

## Routes and ownership

The same editor is served from `/avatar-studio` and `/apps/streamweaver/avatar-studio`. The StreamWeaver Persona page links to the app-relative route. Avatar media uploads are made into the current tenant's media store using the signed-in owner session; rigging jobs reject assets that belong to another tenant or user.

## 2D and 3D source selection

- 2D mode uploads an idle PNG/WebP and an optional mouth-open image, publishes them, and saves the resulting URLs to the tenant's StreamWeaver appearance settings.
- 3D mode accepts a single-file GLB. Imported animation clips can be exported together with the model before upload. The editor retains the existing orbit preview, embedded clip selector, shared motion retargeting, and local trigger-map editor.
- The small model-fit controls adapt the ZIP's `TweakControls` state model. Non-default scale/offset changes are exported with the GLB; facial movement intensity is stored in tenant appearance settings.

## Direct GLB rigging (no photo round-trip)

The direct path reads the user-owned GLB from media storage and sends the job to the Fly worker. The Blender script imports that same GLB, preserves existing rig/animation/shape-key data where supported, adds or locates Head/Jaw/eye bones, assigns limited jaw weights within the head-height band, and exports the processed GLB back to media storage. The output becomes the active `modelUrl` and is announced through `streamweaver.avatar.updated.v1` and `streamweaver.avatar.model.updated.v1`.

The script does **not** render the model into turntable images and does **not** reconstruct a second head from photos. An unrigged head-only GLB can receive a basic Head/Jaw/eye armature; an already-rigged character uses its existing skeleton. Unrigged full-body meshes are rejected instead of being incorrectly weighted entirely to a head bone. Automatic jaw weighting is heuristic and may need Blender cleanup.

This stage retains existing morph targets but does not invent real ARKit facial deformation shapes. A model with matching morph targets receives the corresponding Audio2Face values; otherwise the adapter rotates a bone named Jaw when present.

## Runtime configuration

Avatar rigging is deliberately opt-in. Enable both `STREAMWEAVER_AVATAR_RIGGING_ENABLED=1` and `STREAMWEAVER_AVATAR_BUILD_ENABLED=1` only after the worker machine has Blender installed and `blender` (or `STREAMWEAVER_BLENDER_BINARY`) is executable. The default script path is `apps/streamweaver/scripts/avatar_geometry.py`. In the sandbox, `SPMT_AVATAR_AI_OUTBOUND_MODE=enabled` is also required. Do not enable the flags until the target runtime actually has Blender; otherwise the job will fail when invoking it.

## Audio2Face bridge

The Studio can save a credential-free `ws://` or `wss://` bridge URL. A separately running bridge must send JSON messages with either a `blendshapes` object keyed by morph-target name or numeric `jawOpen`/`mouthOpen` values from 0 to 1. The existing StreamWeaver browser source consumes those messages for the selected 2D or 3D avatar. This adapter does not start or replace NVIDIA Audio2Face itself.

## ZIP scope

The relevant model-tweak behavior was integrated into the existing StreamWeaver editor and persistent avatar flow. The ZIP's photo-to-mesh `FaceFromPhoto` scaffold was not wired into this path: its tessellation is marked as a placeholder, its generated ARKit position offsets are zero placeholders, and its higher-detail route explicitly falls back to the standard route. Reintroducing that pipeline would reproduce the unwanted model-to-photos-to-new-head round-trip. The ZIP's wallet/NFT/contract UI is also unrelated to the StreamWeaver avatar browser source and is not copied into the production app.
