# Room audio fallback

The Apollo HearMeOut room page uses one shared, authenticated WebSocket for room state and signaling. Existing SpaceMountain sessions and room membership authorize it. The main web ingress forwards WebSocket upgrades to the internal HearMeOut server. No new shared key or sign-in flow is required.

A room with fewer than two distinct human users stays idle. Once a second person joins, the server selects LiveKit when its existing credentials are configured, then direct browser WebRTC if LiveKit fails, then the Apollo WebSocket relay if a direct connection fails. Every participant receives the same transport and epoch, so the room changes together. Missing LiveKit configuration starts with direct WebRTC. A provider failure backs off new LiveKit attempts for one minute, or thirty minutes for quota/rate failures; active rooms keep their working fallback until they empty.

The browser retains its microphone track across changes. It reconnects signaling with bounded backoff, drops stale audio, and limits queued playback. Leaving, removal, or session expiry disconnects access. A temporary identity-service outage preserves previously verified access for up to two minutes while local room membership remains valid; longer outages trigger reconnect rather than a false logout.

Direct WebRTC transfers audio between devices. The final relay forwards 16 kHz mono PCM audio without server decoding or mixing; capture, conversion, playback and per-person volume run on clients. Relay use still consumes server bandwidth and some CPU. At 25 frames per second, each speaker sends approximately 32 KB/s of PCM before protocol overhead; outgoing relay traffic scales with the number of listeners. This is a voice fallback, not the music playback path. Limits are eight connections per room, 128 active rooms, 30 audio frames per second per sender, fixed frame sizes and bounded socket buffers.

The solo Android companion uses its separate private chat/TTS/music path and does not need this RTC connection. This change does not modify the separate live HearMeOut repository or deploy an Apollo production promotion.

## Validation

- `npm run test:offline` runs the shared tests, including real local WebSocket room isolation, relay forwarding, session outage handling and replacement-connection cleanup.
- `npx playwright install --with-deps chromium` then `npm run test:rtc-browser` exercises two real Chromium clients through the actual web ingress. Synthetic local audio verifies LiveKit failure, direct RTP with audio energy, coordinated relay fallback with a nonzero played waveform, mute, reconnect and membership removal. It uses no live provider credentials or minutes.
- The `rtc-audio` job in Green shared contracts runs this browser test on pushes and pull requests. Android microphone permissions, Bluetooth output and mobile background behavior still require device testing.

## User-hosted relay follow-up

The relay can later run in a PC companion on the user's network while Apollo keeps signaling and room authorization. That requires a reachable endpoint, an availability check and a fallback when the host sleeps or its network blocks inbound traffic. A phone host adds background-execution and battery constraints. Neither hosting option is implemented by this change.
