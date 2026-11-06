import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaNetworkStore } from "../apps/nebula-arcade/dist/async-network-store.js";

test("async Nebula network records preserve enrollment, settings, presence and outbox across restart", async () => {
  const dir=await mkdtemp(join(tmpdir(),"nebula-network-store-")), path=join(dir,"network.sqlite");
  const store=new AsyncNebulaNetworkStore({databasePath:path});
  try {
    await store.initialize();
    assert.deepEqual(await store.enrollment("spmt:alice"),{enrolled:false,excludedGames:[]});
    await store.saveEnrollment("spmt:alice",true,"2026-11-05T10:00:00.000Z");
    await store.excludeGame("spmt:alice","bingo",true,"2026-11-05T10:01:00.000Z");
    assert.deepEqual(await store.enrollment("spmt:alice"),{enrolled:true,excludedGames:["bingo"]});
    await store.saveSettings("tenant-a","room","bingo",{enabled:true,points:5});
    assert.deepEqual(await store.settings("tenant-a","room","bingo"),{enabled:true,points:5});
    await store.recordPresence("tenant-a",{liveUserIds:["alice"],channelByUserId:{alice:"room"},observedAt:"2026-11-05T10:02:00.000Z"});
    assert.deepEqual((await store.presence("tenant-a",Date.parse("2026-11-05T10:02:30.000Z")))?.liveUserIds,["alice"]);
    await store.enqueue("tenant-a","job-1","bingo-generation",{channel:"room"},"2026-11-05T10:03:00.000Z");
    await store.enqueue("tenant-a","job-1","bingo-generation",{channel:"duplicate"},"2026-11-05T10:04:00.000Z");
    assert.equal((await store.pending("tenant-a")).length,1);
    await store.updateJob("tenant-a","job-1","done",{channel:"room"},"2026-11-05T10:05:00.000Z");
    assert.equal((await store.pending("tenant-a")).length,0);
    await store.close();
    const restarted=new AsyncNebulaNetworkStore({databasePath:path});
    try {
      await restarted.initialize();
      assert.deepEqual(await restarted.enrollment("spmt:alice"),{enrolled:true,excludedGames:["bingo"]});
      assert.deepEqual(await restarted.settings("tenant-a","room","bingo"),{enabled:true,points:5});
      assert.equal((await restarted.jobs("tenant-a"))[0].status,"done");
    } finally { await restarted.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("async Nebula network presence rejects stale and future snapshots", async () => {
  const dir=await mkdtemp(join(tmpdir(),"nebula-network-presence-")),path=join(dir,"network.sqlite");
  const store=new AsyncNebulaNetworkStore({databasePath:path});
  try {
    await store.initialize();
    await store.recordPresence("tenant-a",{liveUserIds:["alice"],channelByUserId:{},observedAt:"2026-11-05T10:00:00.000Z"});
    assert.equal(await store.presence("tenant-a",Date.parse("2026-11-05T10:03:00.000Z")),undefined);
    assert.equal(await store.presence("tenant-a",Date.parse("2026-11-05T09:59:00.000Z")),undefined);
  } finally { await store.close(); await rm(dir,{recursive:true,force:true}); }
});
