# One video, independent viewing windows

Owner clarification, September 14, 2026: the immediate acceptance target is exactly one server video broadcast. Every explicitly opened HearMeOut and Discord media window watches the same feed, regardless of its viewing location. In HearMeOut, create or join a room first, then open the clapper. Closing all windows does not pause or restart it. A room never owns this program's lifetime. Multiple selectable videos, with at most one selection per viewing room, are a later step after this proof works.

The release test activates a standalone durable program. Its queue, clock and encoder lease have no room foreign key or room expiry. The existing encoder and HLS player are reused; no hidden room is created. Opening a window is read-only. Public requests retain guest/provider attribution and use the operator's existing SPMT execution account, supplying the missing billedUserId that caused the reported HTTP 400. Private room content and host playback controls retain their existing access boundary.

The old machine-owned Discord Activity room is retired only on this approved test deployment. The live donor HearMeOut and production Discord mapping are not changed. The developer Activity URL override is /activity on the test Sprite; /watch is the same broadcast in a website window. Native HearMeOut room watch panes embed /watch. Music/movie legacy Activity URLs resolve to that same program during the test.

Verification added:

- A program runs with zero room records, survives deleting both public/private viewing rooms and reopening its database, and retains 30 seconds of a 210-second item after 180 seconds.
- A guest HTTP request passes through real authenticated SPMT execution jobs and the media worker without creating an Apollo user or joining any room. Request retries do not duplicate jobs or queue entries.
- All Activity aliases and ordinary native room views reference the same program. Private native room content remains protected.
- Browser playback checks cover one encoder, local volume and zero-volume silence, closing all windows, deleting the only viewing room, and reopening on the advancing broadcast.
- Release verification reads the program without starting a video or creating a room. An idle program stays blank until a viewer submits a request.

This does not claim complete provider/catalog parity or actual acceptance inside the tester's Discord client. CI and Sprite deployment evidence must be checked for each deployed commit; implementation text alone is not readiness.


Owner test feedback and correction, September 14, 2026:

- HearMeOut starts at Create Room / Browse Rooms. After joining, the participant card's clapper opens the music/movie window and its request bar. There is no player or feed fetch before that click. An idle program displays a blank video area.
- Closing the clapper, navigating to the directory/home, switching rooms, leaving, or deleting the viewing room destroys that local iframe. Native room binding does not instantiate the old hidden music and movie players when the single program is active.
- The selected request type reaches the existing resolver, while both types still share one program/queue. Deleting a viewing room leaves that program advancing. A new room is silent until its clapper is opened.
- Routine shell snapshots repeated host.hello. HMO republished its manifest each time; the shell re-opened the remembered Rooms page, which cleared the room console. HMO now publishes once per launch in each document, retaining initial/reloaded-document handshakes. Visibility/online recovery renews presence without rejoining.
- Deployment verification never queues a video. A narrowly scoped, idempotent cleanup removes only the exact deployment sample request seeded by PR #107; even a viewer request for that same URL is retained.
- Regression coverage includes the actual mobile HMO UI inside the AppFrame bridge, a typed request producing real HLS video, 100 seconds of recurring shell snapshots, and the complete close/delete/create/reopen sequence. Provider adapters use a local media fixture in this browser test; the existing HTTP integration test exercises real SPMT jobs and the media worker. Actual provider availability and Discord client acceptance remain distinct from those checks.
