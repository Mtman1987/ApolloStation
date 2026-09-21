import {spawnSync} from 'node:child_process';

// Run on the development machine before merging to main. GitHub only deploys.
const steps = [
  ['npm', ['run', 'test:sprite']],
  ['node', ['scripts/test-rtc-browser.mjs']],
  ...['hls', 'media', 'room-window', 'cached-audio', 'screen'].map(name => ['node', [`scripts/test-hmo-${name}-browser.mjs`]]),
];
for (const [command, args] of steps) {
  console.log(`\nLocal validation: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {stdio:'inherit', shell:process.platform === 'win32'});
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Local validation passed. Ready to merge to main and deploy.');
