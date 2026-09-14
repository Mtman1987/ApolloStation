import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hearMeOutCutoverEnvironment } from './hearmeout-cutover-config.mjs';

// Owner-approved test activation. Reuse the transferred Apollo owner binding;
// never read the live database or change a live Discord application mapping.
export async function enableHearMeOutBroadcastTest(dataRoot, mediaRoot) {
  await hearMeOutCutoverEnvironment(dataRoot);
  const path = resolve(dataRoot, 'hearmeout-cutover.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  const ffmpegBinary = resolve(mediaRoot, 'ffmpeg'), ffprobeBinary = resolve(mediaRoot, 'ffprobe'), ytDlpBinary = resolve(mediaRoot, 'yt-dlp');
  for (const binary of [ffmpegBinary, ffprobeBinary, ytDlpBinary]) await access(binary, constants.X_OK);
  config.broadcast = {ffmpegBinary, ffprobeBinary};
  config.mediaWorker = {ytDlpBinary};
  // Public application ID from hearmeout-main/fly.toml. The developer URL
  // override points this existing Activity at Apollo only for the tester.
  config.activity ??= {clientId:config.discord?.clientId ?? '1279582181768957963'};
  await writeFile(path + '.next', JSON.stringify(config), {mode:0o600});
  await rename(path + '.next', path);
  await hearMeOutCutoverEnvironment(dataRoot);
  return {broadcastConfigured:true, mediaWorkerConfigured:true, activityClientId:config.activity.clientId};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.DEPLOY_ROLE !== 'release') throw Error('Broadcast test activation requires the approved release target');
  console.log(JSON.stringify(await enableHearMeOutBroadcastTest('/home/sprite/data/release', '/home/sprite/runtime/ffmpeg-btbn-8.1.2-g1a748fe2cd')));
}
