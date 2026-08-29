# MountainView and Companion device gateway

SPMT is the only public authority for personal device enrollment. The signed-in user creates a five-minute, single-use bootstrap proposal containing only a device id, display name, kind and explicit capability grants. The code is stored only as a SHA-256 digest and a proposed device does not appear as paired until the local Companion exchanges it.

Exchange creates:

- one tenant/user/device record in SPMT;
- a unique `companion:<deviceId>` machine identity;
- a random credential returned once to the local secure store;
- a short-lived access token restricted to that tenant;
- only `jobs:read`, `jobs:work`, `jobs:companion` and `runtime:write` scopes.

The narrow `jobs:companion` scope permits the device to claim only `executionOwner=companion` work and does not grant `jobs:any`. Revoking the user-visible device revokes the machine identity, invalidates already issued access tokens through the authorization version, and rejects credential renewal.

MountainView sends paired local actions through `companion.device.command.v1` jobs. The local worker verifies tenant, physical device id, job owner/source app equality, capability, confirmation and lease fencing before invoking a local adapter. Replays return the stored receipt; transient adapter failures remain retryable and redacted. Companion-local jobs use the Companion metering target and therefore remain visible without consuming a paid plan's hosted allowance.

The remaining hardware acceptance gates are real phone/BLE/glasses clients, Xbox provider sessions, OBS WebSocket, multi-monitor windows, FFmpeg on target hardware and signed desktop installation/update.
