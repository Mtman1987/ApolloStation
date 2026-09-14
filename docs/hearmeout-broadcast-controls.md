# Broadcast controls

The broadcast service owns the program ID, queue, and clock. Rooms, Discord Activities, and browser popouts are viewers. Closing a viewer does not stop, pause, or delete the program.

## Current testing policy

Anyone using the broadcast window can Skip the current item or Clear queue. Clear removes upcoming requests and leaves the current item and its clock unchanged. Skip advances to the next request, or leaves the broadcast idle if the queue is empty. Shared play, pause, stop, and seek are not supported. A stale skip cannot skip the following item.

Disconnect, sound, volume, fullscreen, and Reset player affect only that window. HearMeOut popout disconnects the in-room player; Watch again closes its popout before reconnecting. Discord uses its native Activity Pop Out control. Every view attaches to the existing broadcast.

## Before public rollout

Replace the testing policy with verified viewer identity and voting. Reuse Discord Stream Hub's saved admin-role configuration; do not create a second admin-role list. Members of those roles may skip or clear directly. The original requester may skip their own current request without a vote. Other viewers require a skip vote; non-admin queue clearing requires a clear vote. Vote thresholds and eligibility remain to be decided. None of these permissions depend on the original room remaining open or the requester remaining connected.

The source cache retains finite media from segment zero; only the outgoing broadcast uses a rolling live window. Clearing a queue or resetting a local player does not delete source media. Existing truncated or interrupted caches must be prepared again because their missing segments cannot be recovered by a browser refresh.
