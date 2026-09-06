import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ absWorkingDir: root, entryPoints: ['apps/hearmeout/src/rtc-browser.ts'], outfile: 'apps/hearmeout/dist/rtc-client.js',
  bundle: true, platform: 'browser', format: 'iife', target: ['chrome100', 'firefox115', 'safari16'], minify: true });
