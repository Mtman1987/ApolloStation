#!/usr/bin/env node

import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, stat, readdir, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const run = promisify(execFile);

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const ffplay = args.includes('--ffplay');
const keep = args.includes('--keep');
const portArg = valueAfter('--port');
const port = portArg ? Number(portArg) : 0;
const target = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--port');

const YT_DLP = process.env.YT_DLP_BINARY || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_BINARY || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BINARY || 'ffprobe';
const FFPLAY = process.env.FFPLAY_BINARY || 'ffplay';

if (!demo && !target) usage(2);
if (portArg && (!Number.isSafeInteger(port) || port < 0 || port > 65535)) fail('Invalid --port value');

const root = await mkdtemp(join(tmpdir(), 'hmo-single-broadcast-'));
const outDir = join(root, 'broadcast');
await mkdir(outDir, { recursive: true });

let server;
let encoder;
let player;
let stopping = false;

try {
  const source = demo ? await makeDemoSource(root) : await resolveYoutube(target);
  console.log('\nSource proof');
  console.log('  title:       ', source.title || '(unknown)');
  console.log('  source:      ', safeUrl(source.url));
  console.log('  selected:    ', source.formatSummary || 'muxed A/V source');

  const sourceProbe = await probe(source.url);
  const videoStreams = sourceProbe.streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = sourceProbe.streams.filter((stream) => stream.codec_type === 'audio');
  if (!videoStreams.length || !audioStreams.length) {
    fail(`Resolved source is not combined A/V: video=${videoStreams.length} audio=${audioStreams.length}`);
  }
  console.log(`  ffprobe:      ${videoStreams.length} video + ${audioStreams.length} audio stream(s) in ONE input`);

  encoder = startEncoder(source.url, outDir);
  encoder.once('exit', (code, signal) => {
    if (!stopping && code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.error(`\nEncoder exited unexpectedly: code=${code} signal=${signal || 'none'}`);
    }
  });

  await waitForManifest(join(outDir, 'index.m3u8'), 30000);
  await waitForSegments(outDir, 2, 30000);

  const manifest = await readFile(join(outDir, 'index.m3u8'), 'utf8');
  const segments = (await readdir(outDir)).filter((name) => name.endsWith('.ts'));
  if (!manifest.includes('#EXTM3U') || segments.length < 2) fail('Broadcast HLS did not advance');

  const outputProbe = await probe(join(outDir, 'index.m3u8'));
  const outputVideo = outputProbe.streams.filter((stream) => stream.codec_type === 'video');
  const outputAudio = outputProbe.streams.filter((stream) => stream.codec_type === 'audio');
  if (!outputVideo.length || !outputAudio.length) fail('Broadcast output is missing video or audio');

  server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('HearMeOut single-source proof\n\nFeed: /index.m3u8\nStatus: /status\n');
        return;
      }
      if (requestUrl.pathname === '/status') {
        const files = await readdir(outDir);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          sourceInputs: 1,
          encoderProcesses: encoder && encoder.exitCode === null ? 1 : 0,
          segments: files.filter((name) => name.endsWith('.ts')).length,
          video: outputVideo.length,
          audio: outputAudio.length
        }, null, 2));
        return;
      }
      const name = basename(requestUrl.pathname);
      if (!/^(?:index\.m3u8|segment_\d+\.ts)$/.test(name)) {
        res.writeHead(404).end();
        return;
      }
      const filePath = join(outDir, name);
      const info = await stat(filePath);
      res.writeHead(200, {
        'content-type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        'content-length': info.size,
        'cache-control': name.endsWith('.m3u8') ? 'no-store' : 'public, max-age=60',
        'access-control-allow-origin': '*'
      });
      createReadStream(filePath).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });

  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  console.log('\nPASS: one source -> one encoder -> one shared live broadcast');
  console.log(`  source inputs: 1`);
  console.log(`  encoders:      1`);
  console.log(`  output probe:  ${outputVideo.length} video + ${outputAudio.length} audio`);
  console.log(`  HLS segments:  ${segments.length}+ and advancing`);
  console.log(`  feed:          ${origin}/index.m3u8`);
  console.log(`  status:        ${origin}/status`);
  console.log(`  temp dir:      ${root}`);

  if (ffplay) {
    player = spawn(FFPLAY, ['-loglevel', 'warning', '-fflags', 'nobuffer', `${origin}/index.m3u8`], { stdio: 'inherit' });
  }

  if (demo && !keep && !ffplay) {
    console.log('\nDemo self-test complete. Use --keep to leave the feed running.');
  } else {
    console.log('\nPress Ctrl+C to stop.');
    await untilSignal();
  }
} finally {
  stopping = true;
  if (player && player.exitCode === null) player.kill('SIGTERM');
  if (encoder && encoder.exitCode === null) {
    encoder.kill('SIGTERM');
    await Promise.race([onceExit(encoder), sleep(2000)]);
    if (encoder.exitCode === null) encoder.kill('SIGKILL');
  }
  if (server) await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}

function valueAfter(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function resolveYoutube(value) {
  const videoId = youtubeId(value);
  if (!videoId) fail('Pass a YouTube video URL or 11-character video ID');
  let stdout;
  try {
    ({ stdout } = await run(YT_DLP, [
      '--ignore-config',
      '--js-runtimes', 'node',
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--', `https://www.youtube.com/watch?v=${videoId}`
    ], { timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    fail(`yt-dlp failed: ${compactError(error)}`);
  }

  let body;
  try { body = JSON.parse(stdout); }
  catch { fail('yt-dlp returned invalid JSON'); }

  const formats = Array.isArray(body.formats) ? body.formats : [];
  const selected = [...formats].reverse().find((item) =>
    typeof item?.url === 'string' &&
    item.vcodec && item.vcodec !== 'none' &&
    item.acodec && item.acodec !== 'none'
  );
  if (!selected) {
    const summary = formats.slice(-15).map((item) => `${item.format_id || '?'}:${item.vcodec || 'none'}+${item.acodec || 'none'}`).join(', ');
    fail(`yt-dlp found no single muxed A/V format. Recent formats: ${summary}`);
  }

  return {
    title: typeof body.title === 'string' ? body.title : videoId,
    url: selected.url,
    formatSummary: `format=${selected.format_id || '?'} ${selected.ext || ''} ${selected.width || '?'}x${selected.height || '?'} v=${selected.vcodec} a=${selected.acodec}`
  };
}

async function makeDemoSource(dir) {
  const file = join(dir, 'demo.mp4');
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2',
    '-movflags', '+faststart', file
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return { title: 'synthetic local A/V proof', url: file, formatSummary: 'local MP4 containing video+audio' };
}

function startEncoder(source, outputDir) {
  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-threads', '2',
    '-re', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_delete_threshold', '3',
    '-hls_flags', 'delete_segments+append_list+discont_start+omit_endlist',
    '-hls_segment_filename', join(outputDir, 'segment_%06d.ts'),
    join(outputDir, 'index.m3u8')
  ];
  if (ffmpegArgs.filter((value) => value === '-i').length !== 1) fail('Internal error: proof must use exactly one FFmpeg input');
  return spawn(FFMPEG, ffmpegArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
}

async function probe(source) {
  let stdout;
  try {
    ({ stdout } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-of', 'json', source], {
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024
    }));
  } catch (error) {
    fail(`ffprobe failed for ${safeUrl(source)}: ${compactError(error)}`);
  }
  const parsed = JSON.parse(stdout);
  return { streams: Array.isArray(parsed.streams) ? parsed.streams : [] };
}

async function waitForManifest(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await readFile(path, 'utf8');
      if (body.includes('#EXTM3U')) return;
    } catch {}
    await sleep(150);
  }
  fail('Timed out waiting for HLS manifest');
}

async function waitForSegments(dir, count, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = await readdir(dir).catch(() => []);
    if (files.filter((name) => name.endsWith('.ts')).length >= count) return;
    await sleep(150);
  }
  fail(`Timed out waiting for ${count} HLS segments`);
}

function youtubeId(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    }
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return null;
    const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.slice(0, 80)}${url.search ? '?[signed-query-redacted]' : ''}`;
  } catch { return resolve(String(value)); }
}

function compactError(error) {
  return String(error?.stderr || error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 600);
}

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }
function onceExit(child) { return new Promise((done) => child.once('exit', done)); }
function untilSignal() { return new Promise((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); }); }
function fail(message) { console.error(`\nFAIL: ${message}`); process.exitCode = 1; throw new Error(message); }
function usage(code = 0) {
  console.log(`Usage:\n  node hmo-youtube-single-broadcast-proof.mjs <youtube-url-or-id> [--ffplay] [--port 8099]\n  node hmo-youtube-single-broadcast-proof.mjs --demo [--ffplay] [--keep]\n\nEnvironment:\n  YT_DLP_BINARY=/path/to/yt-dlp\n  FFMPEG_BINARY=/path/to/ffmpeg\n  FFPROBE_BINARY=/path/to/ffprobe\n  FFPLAY_BINARY=/path/to/ffplay`);
  process.exit(code);
}
