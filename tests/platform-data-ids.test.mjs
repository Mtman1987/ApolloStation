import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";

test("default platform-data IDs remain unique after a persistent store reopens", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-platform-ids-"));
  const path = join(dir, "platform.sqlite");
  const options = { auth: {}, webhookKey: Buffer.alloc(32, 7), now: () => "2026-08-24T12:00:00.000Z" };
  try {
    let store = new SqlitePlatformDataStore(path);
    let data = new PlatformDataService({ ...options, store });
    const first = data.createConversation({ tenantId: "tenant-a", participantUserIds: ["user-a"], kind: "room", title: "First" });
    store.close();

    store = new SqlitePlatformDataStore(path);
    data = new PlatformDataService({ ...options, store });
    const second = data.createConversation({ tenantId: "tenant-a", participantUserIds: ["user-a"], kind: "room", title: "Second" });
    assert.notEqual(second.id, first.id);
    assert.equal(store.listConversations("tenant-a", "user-a").length, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
