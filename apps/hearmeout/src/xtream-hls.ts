// Ported from the donor app's src/lib/watch/xtream-hls.ts. Serves Xtream VOD as HLS.
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getResolvedXtreamStreamUrl, type XtreamKind } from './xtream-provider.js';

type HlsJob = {
  promise: Promise<void>;
  startedAt: number;
};

const jobs = new Map<string, HlsJob>();
const DEFAULT_HLS_BUDGET_BYTES = 1536 * 1024 * 1024;
const HLS_SEGMENT_SECONDS = Number(process.env.WATCH_HLS_SEGMENT_SECONDS || 6);
const HLS_LIST_SIZE = Number(process.env.WATCH_HLS_LIST_SIZE || 90);
const HLS_DELETE_THRESHOLD = Number(process.env.WATCH_HLS_DELETE_THRESHOLD || 12);
const execFileAsync = promisify(execFile);

function hlsRootDir() {
  return process.env.HEARMEOUT_HLS_DIR || process.env.WATCH_HLS_DIR || (process.env.FLY_APP_NAME ? '/data/watch-hls' : join(process.cwd(), 'logs', 'watch-hls'));
}

function cleanStreamId(streamId: string) {
  const clean = String(streamId).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) throw new Error('Invalid Xtream HLS stream id');
  return clean;
}

function parseStreamKey(streamId: string): { kind: XtreamKind; id: string } {
  const clean = cleanStreamId(streamId);
  const match = clean.match(/^(vod|series|live)-(\d+)$/) || clean.match(/^(episode)-(\d+-[a-z0-9]+)$/);
  if (match) return { kind: match[1] as XtreamKind, id: String(match[2]) };
  const numeric = clean.replace(/[^0-9]/g, '');
  if (!numeric) throw new Error('Invalid Xtream HLS stream id');
  return { kind: 'vod', id: numeric };
}

function cleanFileName(fileName: string) {
  const clean = String(fileName || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!clean || clean.includes('..')) throw new Error('Invalid HLS file');
  return clean;
}

function paths(streamId: string) {
  const clean = cleanStreamId(streamId);
  const dir = join(hlsRootDir(), clean);
  return {
    clean,
    dir,
    indexPath: join(dir, 'index.m3u8'),
  };
}

export function isXtreamHlsUrl(playbackUrl: string) {
  return /^\/activity-provider\/xtream\/(?:vod|series)\/\d+$/i.test(playbackUrl)
    || /^\/activity-provider\/xtream\/episode\/\d+-[a-z0-9]+$/i.test(playbackUrl);
}

export function xtreamHlsUrl(playbackUrl: string) {
  const match = playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series)\/(\d+)$/i);
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return `/api/watch/xtream/hls/episode-${String(episodeMatch[1]).toLowerCase()}/index.m3u8`;
  if (!match) return playbackUrl;
  return `/api/watch/xtream/hls/${String(match[1]).toLowerCase()}-${String(match[2])}/index.m3u8`;
}

export async function getXtreamHlsFile(streamId: string, fileName: string) {
  const { dir } = paths(streamId);
  const file = cleanFileName(fileName);
  const filePath = join(dir, file);
  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) return null;

  const contentType = file.endsWith('.m3u8')
    ? 'application/vnd.apple.mpegurl'
    : file.endsWith('.ts')
      ? 'video/mp2t'
      : 'application/octet-stream';

  return {
    contentType,
    contentLength: stats.size,
    stream: createReadStream(filePath),
  };
}

export async function ensureXtreamHls(streamId: string) {
  const { clean, dir, indexPath } = paths(streamId);
  if (jobs.has(clean)) return jobs.get(clean)!.promise;

  const maxJobs = Number(process.env.WATCH_HLS_MAX_JOBS || 1);
  if (jobs.size >= maxJobs) {
    throw new Error(`HLS converter is busy (${jobs.size} active job)`);
  }

  // Register before the first asynchronous operation. Concurrent viewers must
  // share one acquisition/converter, including during cache checks and mkdir.
  const promise = Promise.resolve().then(async () => {
    if (await hasUsableHlsIndex(dir, indexPath)) return;
    if (existsSync(indexPath)) await unlink(indexPath).catch(() => {});
    await mkdir(dir, { recursive: true });
    await pruneHlsRoot();
    await runFfmpegHls(clean, dir, indexPath);
  })
    .catch((error) => {
      // Child-process errors include the credential-bearing input URL.
      console.error(`[HearMeOutXtreamHLS] HLS conversion failed for ${clean}`);
      throw error;
    })
    .finally(() => {
      jobs.delete(clean);
    });

  jobs.set(clean, { promise, startedAt: Date.now() });
  return promise;
}

export async function waitForXtreamHlsIndex(streamId: string, timeoutMs = 45_000) {
  const { dir, indexPath } = paths(streamId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await hasUsableHlsIndex(dir, indexPath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function hasUsableHlsIndex(dir: string, indexPath: string) {
  const stats = await stat(indexPath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0 || stats.size > 1024 * 1024) return false;

  // Bound the read itself as well as stat: a concurrently growing manifest
  // must not allocate an unbounded buffer before the HTTP route validates it.
  const input = createReadStream(indexPath);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      size += chunk.length;
      if (size > 1024 * 1024) return false;
      chunks.push(Buffer.from(chunk));
    }
  } catch { return false; }
  finally { input.destroy(); }
  const manifest = Buffer.concat(chunks).toString('utf8');
  if (!manifest.startsWith('#EXTM3U')) return false;
  if (manifest.includes('#EXT-X-PLAYLIST-TYPE:EVENT')) return false;
  const firstSegment = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!firstSegment) return false;

  const segmentStats = await stat(join(dir, cleanFileName(firstSegment))).catch(() => null);
  return Boolean(segmentStats?.isFile() && segmentStats.size > 0);
}

type ProbedAudioTrack = { sourceIndex?: number; sourceSpecifier?: string; language: string; title: string; index: number };

async function probeMediaStreams(upstreamUrl: string): Promise<{ hasVideo: boolean; audio: ProbedAudioTrack[] }> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-user_agent', 'HearMeOut/1.0',
      '-show_entries', 'stream=index,codec_type:stream_tags=language,title',
      '-of', 'json',
      upstreamUrl,
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 30_000, killSignal: 'SIGKILL' });
    const streams = (JSON.parse(stdout || '{}').streams || []) as Array<{ index?: number; codec_type?: string; tags?: Record<string, string> }>;
    return {
      hasVideo: streams.some((entry) => entry.codec_type === 'video'),
      audio: streams.filter((entry) => entry.codec_type === 'audio').slice(0, 8).map((entry, index) => ({
        sourceIndex: Number(entry.index),
        language: String(entry.tags?.language || '').trim().toLowerCase(),
        title: String(entry.tags?.title || '').trim(),
        index,
      })),
    };
  } catch {
    console.warn('[HearMeOutXtreamHLS] ffprobe failed; using first audio track');
    return { hasVideo: true, audio: [{ sourceSpecifier: 'a:0', language: '', title: '', index: 0 }] };
  }
}

function audioTrackName(track: ProbedAudioTrack) {
  return (track.title || track.language || `track-${track.index + 1}`)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 40) || `track-${track.index + 1}`;
}

function isEnglishTrack(track: ProbedAudioTrack) {
  return /^(?:en|eng|english)$/i.test(track.language) || /\benglish\b/i.test(track.title);
}

async function runFfmpegHls(streamId: string, dir: string, indexPath: string) {
  const stream = parseStreamKey(streamId);
  const upstreamUrl = await getResolvedXtreamStreamUrl(stream.kind, stream.id);
  const media = await probeMediaStreams(upstreamUrl.toString());
  const defaultAudioIndex = Math.max(0, media.audio.findIndex(isEnglishTrack));
  const segmentPattern = join(dir, 'stream_%v_seg_%05d.ts');
  const mapArgs = [
    ...(media.hasVideo ? ['-map', '0:v:0?'] : []),
    ...media.audio.flatMap((track) => ['-map', `0:${track.sourceSpecifier || track.sourceIndex}?`]),
  ];
  const streamMap = [
    ...(media.hasVideo ? [media.audio.length ? 'v:0,agroup:audio,name:video' : 'v:0,name:video'] : []),
    ...media.audio.map((track, index) => [
      `a:${index}`,
      'agroup:audio',
      `name:${audioTrackName(track)}`,
      track.language ? `language:${track.language.replace(/[^a-z0-9-]/g, '')}` : '',
      index === defaultAudioIndex ? 'default:yes' : '',
    ].filter(Boolean).join(',')),
  ].join(' ');
  console.log(`[HearMeOutXtreamHLS] Starting HLS conversion for ${stream.kind} ${stream.id}`);

  await new Promise<void>((resolve, reject) => {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-threads',
      '1',
      '-y',
      '-user_agent',
      'HearMeOut/1.0',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      // Finite VOD/episodes must finish; EOF reconnect otherwise repeats the
      // asset forever and holds the single converter slot indefinitely.
      ...(stream.kind === 'live' ? ['-reconnect_at_eof', '1'] : []),
      '-reconnect_delay_max',
      '5',
      '-i',
      upstreamUrl.toString(),
      ...mapArgs,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-f',
      'hls',
      '-hls_time',
      String(HLS_SEGMENT_SECONDS),
      '-hls_list_size',
      String(HLS_LIST_SIZE),
      ...(HLS_LIST_SIZE > 0 ? ['-hls_delete_threshold', String(HLS_DELETE_THRESHOLD)] : []),
      '-hls_flags',
      HLS_LIST_SIZE > 0 ? 'delete_segments+independent_segments' : 'independent_segments',
      '-var_stream_map',
      streamMap,
      '-master_pl_name',
      'index.m3u8',
      '-hls_segment_filename',
      segmentPattern,
      join(dir, 'stream_%v.m3u8'),
    ];
    const command = process.platform === 'win32' ? 'ffmpeg' : 'nice';
    const args = process.platform === 'win32' ? ffmpegArgs : ['-n', '15', 'ffmpeg', ...ffmpegArgs];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    // Drain diagnostics without retaining upstream URLs or provider secrets.
    child.stderr?.resume();
    child.once('error', () => reject(new Error('HLS converter could not start')));
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`HLS converter exited with ${code}`));
    });
  });
}

async function pruneHlsRoot() {
  const root = hlsRootDir();
  await mkdir(root, { recursive: true });
  const budget = Number(process.env.WATCH_HLS_BUDGET_BYTES || DEFAULT_HLS_BUDGET_BYTES);
  if (!Number.isFinite(budget) || budget <= 0) return;

  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = (
    await Promise.all(dirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(root, entry.name);
        const names = await readdir(dir).catch(() => []);
        const stats = await Promise.all(names.map(async (name) => {
          const filePath = join(dir, name);
          const fileStats = await stat(filePath).catch(() => null);
          return fileStats?.isFile() ? { filePath, size: fileStats.size, mtimeMs: fileStats.mtimeMs } : null;
        }));
        return stats.filter((item): item is { filePath: string; size: number; mtimeMs: number } => Boolean(item));
      }))
  ).flat();

  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= budget) break;
    await unlink(file.filePath).catch(() => {});
    total -= file.size;
  }
}
