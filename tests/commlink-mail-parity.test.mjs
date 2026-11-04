import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("Commlink account mail is user-private, idempotent, readable, and restart durable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "commlink-mail-"));
  const databasePath = join(dir, "authority.sqlite");
  let service;
  try {
    service = createSpmtService({ databasePath, webhookKey: Buffer.alloc(32, 41), host: "127.0.0.1", port: 0, runtimeMode: "sandbox" });
    for (const userId of ["user-a", "user-b", "user-c", "user-x"]) service.authority.ensureUser(userId);
    service.control.registerTenant({ tenantId: "tenant-a", ownerUserId: "user-a", displayName: "Tenant A" });
    service.control.registerTenant({ tenantId: "tenant-x", ownerUserId: "user-x", displayName: "Tenant X" });
    service.data.registerUser({ userId: "user-a", username: "alice", displayName: "Alice", password: "password-a-123", tenantIds: ["tenant-a"] });
    service.data.registerUser({ userId: "user-b", username: "bob", displayName: "Bob", password: "password-b-123", tenantIds: ["tenant-a"] });
    service.data.registerUser({ userId: "user-c", username: "casey", displayName: "Casey", password: "password-c-123", tenantIds: ["tenant-a"] });
    service.data.registerUser({ userId: "user-x", username: "xavier", displayName: "Xavier", password: "password-x-123", tenantIds: ["tenant-x"] });
    const scopes = ["commlink:read", "commlink:write"];
    const tokens = Object.fromEntries(["user-a", "user-b", "user-c", "user-x"].map((userId) => [userId, service.auth.issueHumanSession({ userId, scopes, tenantIds: [userId === "user-x" ? "tenant-x" : "tenant-a"] }).accessToken]));
    await service.listen();
    const address = service.server.address();
    if (!address || typeof address === "string") throw new Error("SPMT did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    const client = (userId) => new SpmtClient({ baseUrl: origin, appId: "commlink", getAccessToken: () => tokens[userId] });

    assert.deepEqual((await client("user-a").findCommlinkRecipients("tenant-a")).map((item) => item.userId), ["user-b", "user-c"]);
    assert.deepEqual((await client("user-a").findCommlinkRecipients("tenant-a", "BOB")).map((item) => item.userId), ["user-b"]);
    const first = await client("user-a").composeCommlinkMail("tenant-a", ["user-b"], "Private hello", "mail-1", "Welcome");
    assert.equal(first.duplicate, false);
    const replay = await client("user-a").composeCommlinkMail("tenant-a", ["user-b"], "Private hello", "mail-1", "Welcome");
    assert.equal(replay.duplicate, true);
    assert.equal(replay.message.id, first.message.id);
    await assert.rejects(() => client("user-a").composeCommlinkMail("tenant-a", ["user-b"], "Changed", "mail-1", "Welcome"), /status 409/);
    await assert.rejects(() => client("user-a").composeCommlinkMail("tenant-a", ["user-x"], "Cross tenant", "mail-2"), /status 400/);

    const inbox = await client("user-b").listCommlinkMailbox("tenant-a", "inbox");
    const sent = await client("user-a").listCommlinkMailbox("tenant-a", "sent");
    assert.equal(inbox.length, 1);
    assert.equal(sent.length, 1);
    assert.equal((await client("user-b").listConversations("tenant-a"))[0].unreadCount, 1);
    assert.equal((await client("user-c").listConversations("tenant-a")).length, 0);
    await assert.rejects(() => client("user-c").markCommlinkConversationRead("tenant-a", first.conversation.id), /status 400/);
    await client("user-b").markCommlinkConversationRead("tenant-a", first.conversation.id);
    assert.equal((await client("user-b").listConversations("tenant-a"))[0].unreadCount, 0);
    assert.equal((await client("user-b").markAllCommlinkRead("tenant-a")).updated, 1);

    await service.close();
    service = createSpmtService({ databasePath, webhookKey: Buffer.alloc(32, 41), host: "127.0.0.1", port: 0, runtimeMode: "sandbox" });
    const restartedToken = service.auth.issueHumanSession({ userId: "user-b", scopes, tenantIds: ["tenant-a"] }).accessToken;
    await service.listen();
    const restartedAddress = service.server.address();
    if (!restartedAddress || typeof restartedAddress === "string") throw new Error("SPMT did not rebind");
    const restarted = new SpmtClient({ baseUrl: `http://127.0.0.1:${restartedAddress.port}`, appId: "commlink", getAccessToken: () => restartedToken });
    assert.equal((await restarted.listConversations("tenant-a"))[0].unreadCount, 0);
    assert.equal((await restarted.listCommlinkMailbox("tenant-a", "inbox"))[0].text, "Private hello");
  } finally {
    if (service?.server.listening) await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
