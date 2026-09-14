# One video, independent viewing windows

Owner clarification, September 14, 2026: the immediate acceptance target is exactly one server video broadcast. Every HearMeOut and Discord window watches the same feed, regardless of room, location, membership, or Apollo signup. Closing all windows does not pause or restart it. A room never owns this program's lifetime. Multiple selectable videos, with at most one selection per viewing room, are a later step after this proof works.

The release test activates a standalone durable program. Its queue, clock and encoder lease have no room foreign key or room expiry. The existing encoder and HLS player are reused; no hidden room is created. Opening a window is read-only. Public requests retain guest/provider attribution and use the operator's existing SPMT execution account, supplying the missing billedUserId that caused the reported HTTP 400. Private room content and host playback controls retain their existing access boundary.

The old machine-owned Discord Activity room is retired only on this approved test deployment. The live donor HearMeOut and production Discord mapping are not changed. The developer Activity URL override is /activity on the test Sprite; /watch is the same broadcast in a website window. Native HearMeOut room watch panes embed /watch. Music/movie legacy Activity URLs resolve to that same program during the test.

Verification added:

- A program runs with zero room records, survives deleting both public/private viewing rooms and reopening its database, and retains 30 seconds of a 210-second item after 180 seconds.
- A guest HTTP request passes through real authenticated SPMT execution jobs and the media worker without creating an Apollo user or joining any room. Request retries do not duplicate jobs or queue entries.
- All Activity aliases and ordinary native room views reference the same program. Private native room content remains protected.
- Browser playback checks cover one encoder, local volume and zero-volume silence, closing all windows, deleting the only viewing room, and reopening on the advancing broadcast.
- Release verification starts a verified public video only if the program is empty. It leaves that video available for the owner to test. It never replaces an existing selection or creates a test room.

This does not claim complete provider/catalog parity or actual acceptance inside the tester's Discord client. CI and Sprite deployment evidence must be recorded after this commit passes; implementation text alone is not readiness.
