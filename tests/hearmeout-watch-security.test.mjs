import assert from 'node:assert/strict';
import test from 'node:test';
import {hearMeOutMovieProviderUrl} from '../apps/hearmeout/dist/movie-provider.js';
import {configuredDonorOrigin,HEARMEOUT_DONOR_DEFAULT_ORIGIN} from '../apps/hearmeout/dist/donor-origin.js';
import {isXtreamHlsUrl,xtreamHlsUrl} from '../apps/hearmeout/dist/xtream-hls.js';
import {cleanHearMeOutHlsFileName,hearMeOutHlsContentType,hearMeOutHlsCacheControl,isAllowedHearMeOutYoutubeMediaUrl} from '../apps/hearmeout/dist/watch-hls-policy.js';

const origin=HEARMEOUT_DONOR_DEFAULT_ORIGIN;

test('donor origin configuration fails closed on anything but a credential-free HTTPS origin',()=>{
 assert.equal(configuredDonorOrigin({}),origin);
 assert.equal(configuredDonorOrigin({HEARMEOUT_DONOR_ORIGIN:''}),origin);
 assert.equal(configuredDonorOrigin({HEARMEOUT_DONOR_ORIGIN:'https://donor.example'}),'https://donor.example');
 for(const bad of ['http://donor.example','https://user:pass@donor.example','https://donor.example/path','https://donor.example/?q=1','https://donor.example/#x','not a url'])
  assert.throws(()=>configuredDonorOrigin({HEARMEOUT_DONOR_ORIGIN:bad}),undefined,bad);
});

test('movie provider URLs are accepted only for the search and HLS routes on the configured origin',()=>{
 assert.ok(hearMeOutMovieProviderUrl(origin+'/api/watch/search?q=heat',origin));
 assert.ok(hearMeOutMovieProviderUrl(origin+'/api/watch/xtream/hls/vod-12/index.m3u8?machine=abc123',origin));
 // Wrong origin, downgraded scheme, and embedded credentials are rejected.
 assert.equal(hearMeOutMovieProviderUrl('https://evil.example/api/watch/search?q=x',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl('http://hearmeout-main.fly.dev/api/watch/search?q=x',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl('https://u:p@hearmeout-main.fly.dev/api/watch/search?q=x',origin),undefined);
 // Fragments, extra params, and non-search routes are rejected.
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/search?q=x#frag',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/search?q=x&key=secret',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/xtream/hls/vod-12/index.m3u8?machine=abc&token=secret',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/admin/accounts',origin),undefined);
 // Path traversal and non-HLS files are rejected.
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/xtream/hls/vod-12/../../secret.m3u8',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/xtream/hls/vod-12/index.json',origin),undefined);
 // Machine pin must be alphanumeric and short.
 assert.equal(hearMeOutMovieProviderUrl(origin+'/api/watch/xtream/hls/vod-12/index.m3u8?machine=a%2Fb',origin),undefined);
 assert.equal(hearMeOutMovieProviderUrl('not a url',origin),undefined);
});

test('Xtream playback URLs map to Apollo HLS paths and never carry credentials or foreign hosts',()=>{
 assert.equal(isXtreamHlsUrl('/activity-provider/xtream/vod/42'),true);
 assert.equal(isXtreamHlsUrl('/activity-provider/xtream/episode/7-abc'),true);
 assert.equal(isXtreamHlsUrl('https://provider.example/movie/user/pass/42.mp4'),false);
 assert.equal(isXtreamHlsUrl('/activity-provider/xtream/vod/42?username=u&password=p'),false);
 assert.equal(xtreamHlsUrl('/activity-provider/xtream/vod/42'),'/api/watch/xtream/hls/vod-42/index.m3u8');
 assert.equal(xtreamHlsUrl('/activity-provider/xtream/series/9'),'/api/watch/xtream/hls/series-9/index.m3u8');
 assert.equal(xtreamHlsUrl('/activity-provider/xtream/episode/7-ABC'),'/api/watch/xtream/hls/episode-7-abc/index.m3u8');
 const mapped=xtreamHlsUrl('/activity-provider/xtream/vod/42');
 assert.doesNotMatch(mapped,/https?:|password|username|@/i);
});

test('HLS file names are stripped of path structure before reaching the filesystem',()=>{
 assert.equal(cleanHearMeOutHlsFileName('index.m3u8'),'index.m3u8');
 assert.throws(()=>cleanHearMeOutHlsFileName('..'),/Invalid HLS file/);
 assert.throws(()=>cleanHearMeOutHlsFileName('a..b.ts'),/Invalid HLS file/);
 assert.throws(()=>cleanHearMeOutHlsFileName(''),/Invalid HLS file/);
 assert.throws(()=>cleanHearMeOutHlsFileName('../../etc/passwd'),/Invalid HLS file/);
 assert.equal(cleanHearMeOutHlsFileName('/etc/passwd'),'etcpasswd');
 assert.equal(hearMeOutHlsContentType('index.m3u8'),'application/vnd.apple.mpegurl');
 assert.equal(hearMeOutHlsContentType('seg-001.ts'),'video/mp2t');
 assert.equal(hearMeOutHlsCacheControl('index.m3u8'),'no-store');
 assert.match(hearMeOutHlsCacheControl('seg-001.ts'),/max-age/);
});

test('YouTube media URLs must be HTTPS on the exact media hosts or their subdomains',()=>{
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('https://rr1---sn.googlevideo.com/videoplayback?x=1'),true);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('https://i.ytimg.com/vi/x/hq.jpg'),true);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('http://rr1.googlevideo.com/x'),false);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('https://evilgooglevideo.com/x'),false);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('https://googlevideo.com.evil.example/x'),false);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('https://evil.example/?u=youtube.com'),false);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl(''),false);
 assert.equal(isAllowedHearMeOutYoutubeMediaUrl('not a url'),false);
});
