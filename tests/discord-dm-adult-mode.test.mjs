import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscordDmAdultModeAssistant } from "../apps/chat-gateway/dist/discord-dm-adult-mode.js";

const dm = (text, overrides = {}) => ({
  schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-main",
  channelId: "1416041303707353119", messageId: "1416041303707353120", text,
  occurredAt: "2026-11-23T00:00:00.000Z", providerUserId: "767875979561009173",
  username: "mtman1987", displayName: "MT", isBot: false, roles: ["member"], mentions: [],
  ...overrides,
});

async function fixture(identityRole = "owner") {
  const directory = await mkdtemp(join(tmpdir(), "apollo-discord-dm-"));
  const sent = [], invocations = [];
  const client = {
    async invokeCommunityAssistant(tenantId, input, key) {
      invocations.push({ tenantId, input, key });
      return { status: "accepted", jobId: "job-dm-1" };
    },
    async getExecutionJob() {
      return { billedUserId: "canonical-owner", state: "succeeded", result: { text: "Stellar answered the private message." } };
    },
  };
  const assistant = new DiscordDmAdultModeAssistant({
    client, databasePath: join(directory, "chat.sqlite"),
    resolveIdentity: async () => ({ userId: "canonical-owner", tenantRole: identityRole }),
    sender: { provider: "discord", async send(message) { sent.push(message); return { providerMessageId: "sent-1" }; } },
    pollMs: 1,
  });
  return { directory, assistant, sent, invocations, close: async () => { assistant.close(); await rm(directory,{recursive:true,force:true}); } };
}

test("owner DM Adult Mode command persists the setting and replies without invoking a model", async () => {
  const f = await fixture();
  try {
    await f.assistant.handle(dm("adult mode on"));
    assert.equal(f.invocations.length,0);
    assert.equal(f.sent.length,1);
    assert.equal(f.sent[0].channelId,"1416041303707353119");
    assert.equal(f.sent[0].replyToMessageId,"1416041303707353120");
    assert.match(f.sent[0].text,/Adult Mode is now ON/);
    await f.assistant.handle(dm("adult mode status",{messageId:"1416041303707353121"}));
    assert.match(f.sent[1].text,/Adult Mode is ON/);
  } finally { await f.close(); }
});

test("owner DM uses Apollo Stellar invocation and sends its completed result into the DM", async () => {
  const f = await fixture();
  try {
    await f.assistant.handle(dm("Can you help me?"));
    assert.equal(f.invocations.length,1);
    assert.equal(f.invocations[0].input.userId,"canonical-owner");
    assert.equal(f.invocations[0].input.surface,"app");
    assert.equal(f.invocations[0].input.conversationId,"discord-private:canonical-owner");
    assert.equal(f.invocations[0].input.presentation.memoryPolicy,"conversation");
    assert.match(f.invocations[0].input.presentation.instructions,/Adult Mode is disabled/);
    assert.equal(f.sent.length,1);
    assert.equal(f.sent[0].text,"Stellar answered the private message.");
  } finally { await f.close(); }
});

test("non-owner DMs are ignored and never enter the assistant", async () => {
  const f = await fixture("member");
  try {
    await f.assistant.handle(dm("private message"));
    assert.equal(f.invocations.length,0);
    assert.equal(f.sent.length,0);
  } finally { await f.close(); }
});

test("replayed Discord DM toggle cannot flip Adult Mode twice", async () => {
  const f = await fixture();
  try {
    const original = dm("adult mode toggle");
    await f.assistant.handle(original);
    await f.assistant.handle(original);
    await f.assistant.handle(dm("adult mode status",{messageId:"1416041303707353122"}));
    assert.equal(f.sent.length,2);
    assert.match(f.sent[1].text,/Adult Mode is ON/);
  } finally { await f.close(); }
});
