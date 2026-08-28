import test from "node:test";
import assert from "node:assert/strict";
import { HearMeOutLiveKitSigner, verifyHearMeOutLiveKitToken } from "../apps/hearmeout/dist/livekit-signer.js";

const secret = "livekit-secret-for-green-tests";

test("authorized microphone grant becomes a short-lived room-bound LiveKit JWT", () => {
  const signer = new HearMeOutLiveKitSigner("livekit-api-key", secret, () => 1_800_000_000, () => "grant-1");
  const issued = signer.sign({
    tenantId: "tenant-1",
    roomId: "room-1",
    roomName: "tenant-1-room-1",
    participantIdentity: "spmt-user-1",
    participantName: "Captain",
    ttlSeconds: 300,
    canPublish: true,
    canSubscribe: true,
    metadata: { role: "member" },
  });
  const claims = verifyHearMeOutLiveKitToken(issued.token, secret);
  assert.equal(claims.iss, "livekit-api-key");
  assert.equal(claims.sub, "spmt-user-1");
  assert.equal(claims.iat, 1_800_000_000);
  assert.equal(claims.exp, 1_800_000_300);
  assert.equal(claims.jti, "grant-1");
  assert.equal(claims.name, "Captain");
  assert.deepEqual(claims.video, { roomJoin: true, room: "tenant-1-room-1", canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
  assert.deepEqual(JSON.parse(claims.metadata), { schemaVersion: 1, tenantId: "tenant-1", roomId: "room-1", role: "member" });
  assert.equal(issued.expiresAt, new Date(1_800_000_300 * 1000).toISOString());
});

test("listen-only room grant cannot publish audio or data", () => {
  const signer = new HearMeOutLiveKitSigner("livekit-api-key", secret, () => 1_800_000_000, () => "grant-listener");
  const claims = verifyHearMeOutLiveKitToken(signer.sign({ tenantId: "tenant-1", roomId: "room-1", roomName: "tenant-1-room-1", participantIdentity: "listener-1", ttlSeconds: 60, canPublish: false, canSubscribe: true }).token, secret);
  assert.equal(claims.video.canPublish, false);
  assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.video.canSubscribe, true);
});

test("signer enforces bounded grants and never accepts missing credentials", () => {
  assert.throws(() => new HearMeOutLiveKitSigner("", secret), /key and secret/);
  const signer = new HearMeOutLiveKitSigner("livekit-api-key", secret);
  assert.throws(() => signer.sign({ tenantId: "tenant-1", roomId: "room-1", roomName: "room", participantIdentity: "u", ttlSeconds: 29, canPublish: true, canSubscribe: true }), /30 and 900/);
  assert.throws(() => signer.sign({ tenantId: "tenant-1", roomId: "room-1", roomName: "room", participantIdentity: "u", ttlSeconds: 901, canPublish: true, canSubscribe: true }), /30 and 900/);
});

test("JWT verification fails closed when the signature is changed", () => {
  const signer = new HearMeOutLiveKitSigner("livekit-api-key", secret, () => 1_800_000_000, () => "grant-tamper");
  const token = signer.sign({ tenantId: "tenant-1", roomId: "room-1", roomName: "room", participantIdentity: "u", ttlSeconds: 60, canPublish: true, canSubscribe: true }).token;
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.throws(() => verifyHearMeOutLiveKitToken(tampered, secret), /signature/);
});
