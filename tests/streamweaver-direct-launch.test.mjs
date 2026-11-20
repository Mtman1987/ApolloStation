import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAppFrameTarget, resolveShellAppLaunchUrl } from '../apps/spacemountain/dist/index.js';
import { SpaceMountainShellUi } from '../apps/spacemountain/dist/shell-ui-base.js';
test('both StreamWeaver launch paths use Node 2', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://apollo-node-1.hostless.app' } };
  try {
    const app = { appId: 'streamweaver', launchUrl: 'https://spacemountain.live/apps/streamweaver?view=integrations#integrations', installed: true, enabled: true, surfaces: ['shell'], grantedScopes: [] };
    const initial = SpaceMountainShellUi.prototype.shellLaunchUrl.call({}, app);
    const target = buildAppFrameTarget(app, 'tenant-owner', 'launch-test' === '' ? 'standalone' : 'shell', 'launch-test');
    assert.equal(initial, 'https://apollo-node-2.hostless.app/apps/streamweaver?view=integrations&surface=shell#integrations');
    assert.equal(target.url, initial);
    assert.equal(target.allowedOrigin, 'https://apollo-node-2.hostless.app');
    for (const appId of ['stellar-core', 'hearmeout', 'discord-stream-hub', 'nebula-arcade', 'external-app']) {
      const other = { ...app, appId };
      assert.equal(buildAppFrameTarget(other, 'tenant-owner', 'shell', 'launch-test').url, other.launchUrl);
    }
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});
