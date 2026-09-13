import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDiscordStreamHubWebServer } from '../apps/discord-stream-hub/dist/web-server.js';
import { SqliteDshApplicationStore } from '../apps/discord-stream-hub/dist/applications.js';

async function fixture(t, operationMode = 'read-only') {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-community-controls-'));
  const databasePath = join(directory, 'state.sqlite'), runtimeConfigPath = join(directory, 'runtime.json');
  const tenantId = 'tenant', guildId = '12345', channelId = '23456', applicantDiscordId = '34567';
  writeFileSync(runtimeConfigPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{
    tenantId, twitchProviderUserId: 'twitch', discordProviderUserId: 'discord', discordGuildIds: [guildId],
    branding: { communityMemberName: 'Mountaineer' }, members: [
      { canonicalUserId: 'crew', discordUserId: '45678', twitchLogin: 'crew', group: 'Crew', shoutoutChannelId: channelId },
    ],
  }] }));
  const spmt = createServer((request, response) => {
    const actorId = request.headers.cookie;
    response.setHeader('content-type', 'application/json');
    if (!actorId) { response.writeHead(401); response.end(JSON.stringify({ error: 'sign_in_required' })); return; }
    if (request.url === '/v1/session') response.end(JSON.stringify({ actorId, displayName: actorId, tenantIds: [tenantId], tenantRoles: { [tenantId]: actorId === 'owner' ? 'owner' : 'member' } }));
    else if (request.url === '/v1/identity/providers') response.end(JSON.stringify({ providers: [{ provider: 'discord', providerUserId: actorId === 'candidate' ? applicantDiscordId : '99999', displayName: actorId }] }));
    else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise(resolve => spmt.listen(0, '127.0.0.1', resolve));
  const spmtOrigin = `http://127.0.0.1:${spmt.address().port}`;
  const events = [], messages = [];
  let failReaction = false;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/auth/service-token') return Response.json({ accessToken: 'service-token', accessExpiresAt: '2099-01-01T00:00:00Z' });
    if (path === '/v1/provider-grants') return Response.json({ expiresAt: '2099-01-01T00:00:00Z', credential: { accessToken: 'test-only-provider-token', metadata: { authorizationScheme: 'Bot' } } });
    if (path === '/v1/simulation-rooms') return Response.json([{ roomId: 'test-room', name: 'Test room' }]);
    if (path === '/v1/simulation-rooms/events') { events.push(JSON.parse(init.body)); return Response.json({}); }
    if (path === '/api/v10/users/@me/channels') return Response.json({ id: '77777' });
    if (path === '/api/v10/channels/77777/messages') { messages.push(JSON.parse(init.body)); return Response.json({ id: '67890' }); }
    if (path === '/api/v10/users/@me/guilds') return Response.json([{ id: guildId, name: 'Community' }, { id: '88888', name: 'Unrelated tenant' }]);
    if (path === `/api/v10/guilds/${guildId}/channels`) return Response.json([{ id: channelId, name: 'proposals', type: 0 }]);
    if (path === `/api/v10/channels/${channelId}/messages`) { messages.push(JSON.parse(init.body)); return Response.json({ id: '56789' }); }
    if (path.includes('/reactions/')) {
      if (failReaction) { failReaction = false; return Response.json({ message: 'Try again' }, { status: 503 }); }
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected provider request: ${path}`);
  };
  const host = createDiscordStreamHubWebServer({ spmtOrigin, publicOrigin: 'https://apollo.example', discordPublicKey: 'ab'.repeat(32), databasePath, runtimeConfigPath, host: '127.0.0.1', port: 0, credential: 'test-worker-credential-123456789012345', operationMode, fetchImpl });
  await host.listen();
  const origin = `http://127.0.0.1:${host.server.address().port}`;
  const api = origin + '/apps/discord-stream-hub/api/control';
  const store = new SqliteDshApplicationStore(databasePath);
  t.after(async () => { store.close(); await host.close(); await new Promise(resolve => spmt.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const get = (path, actor = 'owner') => fetch(api + path, { headers: { cookie: actor } });
  const post = (path, body, actor = 'owner') => fetch(api + path, { method: 'POST', headers: { cookie: actor, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { get, post, store, tenantId, guildId, channelId, applicantDiscordId, events, messages, failNextReaction: () => { failReaction = true; } };
}

test('DSH serves publishing, blind advisory votes, decisions and identity-bound receipts through one app server', async t => {
  const f = await fixture(t, 'active');
  const published = await f.post('/applications/publish', { serverId: f.guildId, channelId: f.channelId });
  assert.equal(published.status, 200, await published.text());
  const application = f.store.submit({ tenantId: f.tenantId, guildId: f.guildId, interactionId: 'submission-one', type: 'mod', applicantDiscordId: f.applicantDiscordId, applicantUsername: 'Candidate', answers: { motivation: 'Help the community' } }).application;
  assert.equal((await f.get('/applications/reviews', 'candidate')).status, 403);
  assert.equal((await f.post('/applications/vote', { applicationId: application.id, vote: 'approve' }, 'crew')).status, 200);
  const crewReview = await (await f.get('/applications/reviews', 'crew')).json();
  assert.equal(crewReview.applications[0].myVote, 'approve');
  assert.equal('votes' in crewReview.applications[0], false);
  assert.equal((await f.post('/applications/decide', { applicationId: application.id, decision: 'approved' }, 'crew')).status, 403);
  const decision = await f.post('/applications/decide', { applicationId: application.id, decision: 'approved' });
  assert.equal(decision.status, 200);
  assert.equal((await decision.json()).notification, 'sent');
  const dm = f.messages.find(message => message.enforce_nonce);
  const offerUrl = new URL(dm.components[0].components[0].url);
  const token = offerUrl.searchParams.get('token');
  const query = new URLSearchParams({ applicationId: application.id, token });
  const agreement = await (await f.get('/applications/agreement?' + query, 'candidate')).json();
  assert.equal(agreement.identityMatches, true, 'SPMT provider envelopes are resolved before acceptance');
  const body = { applicationId: application.id, token, reviewedTerms: true, electronicConsent: true };
  assert.equal((await f.post('/applications/agreement', body, 'crew')).status, 403);
  const accepted = await f.post('/applications/agreement', body, 'candidate');
  assert.equal(accepted.status, 200);
  const receiptId = (await accepted.json()).acceptance.acceptanceId;
  query.set('format', 'receipt');
  assert.equal((await f.get('/applications/agreement?' + query, 'crew')).status, 403);
  const receipt = await f.get('/applications/agreement?' + query, 'candidate');
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).acceptanceId, receiptId);
});

test('DSH proposal retry preserves the posted message and rejects channels outside the tenant', async t => {
  const f = await fixture(t, 'active');
  const state = await (await f.get('/proposals/state')).json();
  assert.equal(state.channels.some(channel => channel.guildName === 'Unrelated tenant'), false);
  const proposal = { channelId: f.channelId, title: 'Community night', description: 'Choose our next event', audience: 'community' };
  assert.equal((await f.post('/proposals/post', proposal, 'candidate')).status, 403);
  assert.equal((await f.post('/proposals/post', { ...proposal, channelId: '77777' })).status, 400);
  f.failNextReaction();
  const failed = await f.post('/proposals/post', proposal);
  assert.equal(failed.status, 502);
  const stored = (await failed.json()).proposal;
  assert.equal(stored.delivery.messageId, '56789');
  const retry = await f.post('/proposals/retry', { proposalId: stored.id });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).proposal.delivery.status, 'delivered');
  assert.equal(f.messages.length, 1, 'reaction retry must reuse the original Discord message');
});
