# HearMeOut supervised runtime

HearMeOut's canonical room, membership, invitation, presence, queue, playback and voice-bridge desired state remains app-private SQLite state. Elastic media workers never become an authority.

The production-shaped worker uses the shared `ExecutionJobV1` lifecycle and the `hearmeout` service identity. It may claim only HearMeOut work, renew a fenced lease, emit bounded progress, and publish a public result. Music search and recent-user catalog updates are restart-safe. YouTube resolution invokes an explicitly configured absolute `yt-dlp` binary without a shell and accepts only the existing YouTube/Google media host allowlist.

The supervised Sprite starts the real worker binary with:

- an empty tenant list;
- sandbox-named database, cache and configuration paths;
- provider egress disabled;
- no LiveKit, Discord, YouTube or Fly credentials;
- a credential distinct from Chat Gateway, StreamWeaver, DSH and Nebula Arcade.

This proves build, authentication, storage initialization, worker leasing and shutdown composition without claiming live-media acceptance. Production configuration must explicitly enable media-resolution capabilities and supply the local resolver binary. LiveKit and Discord credentials continue to come only from short-lived SPMT provider grants; they are not persisted in jobs, configuration or worker logs.
