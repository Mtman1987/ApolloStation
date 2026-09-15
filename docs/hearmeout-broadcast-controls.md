# Broadcast controls

The broadcast service owns one durable program, mixed music/movie queue, and clock per watch party. The opening Watch parties menu lists party names and current media, and lets viewers watch an existing party or create one. The previous `main-broadcast` program remains intact as Main watch party; the existing deployment flag continues to select this broadcast implementation.

Voice and viewing are independent. Watching another room's public broadcast does not join that room, leave the viewer's current voice conversation, expose private chat, or move Discord users between channels. A pair of viewers can stay in their own private conversation while watching the same movie as another party.

An Apollo room or configured Discord channel can host at most one party, enforced transactionally in the durable store. Concurrent creates and retries return that room's existing party. Viewing another party never replaces the hosted party. A separate hosted broadcast needs a different/new room or Discord channel. Closing a viewer does not stop, pause, or delete a broadcast or release the hosting assignment.

Each party has its own state and HLS feed. Requests, skip/clear controls, playback completion, and encoder leases are scoped to that party across music and movies. Unknown party IDs fail rather than falling back to the main program. Only the two explicit legacy Discord session aliases still reference Main watch party. Public directory/state responses contain media information, not voice membership or private room messages.

## Current testing policy

Anyone using the broadcast window can Skip the current item or Clear queue. Clear removes upcoming requests and leaves the current item and its clock unchanged. Skip advances to the next request, or leaves the broadcast idle if the queue is empty. Shared play, pause, stop, and seek are not supported. A stale skip cannot skip the following item.

Disconnect, sound, volume, fullscreen, and Reset player affect only that window. HearMeOut popout disconnects the in-room player; Watch again closes its popout before reconnecting. Discord uses its native Activity Pop Out control. Every view attaches to the selected party’s existing broadcast.

## Before public rollout

Replace the testing policy with verified viewer identity and voting. Reuse Discord Stream Hub's saved admin-role configuration; do not create a second admin-role list. Members of those roles may skip or clear directly. The original requester may skip their own current request without a vote. Other viewers require a skip vote; non-admin queue clearing requires a clear vote. Vote thresholds and eligibility remain to be decided. None of these permissions depend on the original room remaining open or the requester remaining connected.

The source cache retains finite media from segment zero; only the outgoing broadcast uses a rolling live window. Clearing a queue or resetting a local player does not delete source media. Existing truncated or interrupted caches must be prepared again because their missing segments cannot be recovered by a browser refresh.

## New YouTube sources

Saved HLS and browser-uploaded tracks remain the first choice. If browser acquisition fails, Apollo explicitly asks the DJ worker to prepare one source. The worker runs an official YouTube player on a private Chromium display and records its video and audio into the existing HLS cache using Xvfb, PulseAudio, and FFmpeg. The job is shared by video ID and continues after the requesting window closes. Viewers receive only the existing broadcast feed.

The capture uses the worker's network and a fresh browser profile, not the viewer's verified YouTube session. YouTube may still deny playback or embedding; such refusal is reported as a source failure. Playback through this capture path needs live verification. Recording is limited to two concurrent sources, three hours per source, and the existing disk-space guard. Completed sources are reusable subject to the existing cache eviction policy.

## Shared screen output

Share screen to watch party sends the window/tab selected in the browser chooser to that room’s hosted party. The room can have one active screen publisher. Screen audio comes only from the selected display capture; private microphone/voice-chat audio is not added. The player’s Output selector switches locally between Movie / music and Screen share. Switching leaves the existing queue and every other viewer’s selection alone.

Authenticated room members who are allowed to publish upload ordered, bounded WebM chunks. HearMeOut encodes a short rolling HLS feed so Discord viewers use the same HTTP player without entering the voice room. Stop, loss of membership/publishing permission, 20 seconds without uploads, and process restart end the live share. Old feed URLs stop serving on termination. Closing the watch window alone does not stop the publisher; use Stop sharing or the browser’s capture control.

The player stays in a bounded view box. Fullscreen attempts the native API and retains an expanded view with a visible exit button when the embedding client blocks native fullscreen. Discord native popouts initialize through the Discord host opener; restored windows resume their player polling and selected output. Browser popouts retain the party and output.

## Persona conversation controls

Send shows progress and the text reply independently of optional speech preparation or playback. A denied/failed audio operation cannot erase a completed reply or hold the composer until audio finishes. Retrying an unchanged draft reuses the request key.

Talk uses the configured server transcription worker when available. When server speech is unavailable, supported browsers can use browser speech recognition after the explicit Talk action; Chrome may process that recognition through its browser speech service. Permission denial, missing browser support and recording errors are shown next to the controls. This does not enable server provider egress or change the persona’s selected voice: synthesized replies still require an available server speech worker.
