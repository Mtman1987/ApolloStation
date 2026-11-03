# DSH MtFixIt compatibility intake

The DSH worker now recognizes `!mtfixit <description>` in configured Discord guilds. It records a redacted Operations Log entry and creates an Apollo Coder job targeted to the DSH app. The Coder job is evidence-only: this adapter does not approve, merge, or deploy a patch.

The report receipt is stored in the DSH SQLite database and keyed by the upstream Chat Gateway event ID. The log and Coder job also use stable idempotency keys, so event replay does not create a second repair job. Owner notification uses `DSH_MTFIXIT_OWNER_DISCORD_ID`; set it to the Discord user ID that should receive repair reports. If it is not configured, the job is still saved and the channel reply explicitly says that owner DM delivery is not configured.

The command currently targets `discord-stream-hub` only. Cross-app repair routing is deliberately not granted by this adapter: that requires an explicit platform-wide Coder authorization decision. Existing Mission Control/Coder availability and owner review remain authoritative.
