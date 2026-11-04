// Unencrypted HLS from Shaka Player's maintained demo catalog:
// https://github.com/shaka-project/shaka-player/blob/main/demo/common/assets.js
export const HEARMEOUT_TEST_SOURCE = 'https://storage.googleapis.com/shaka-demo-assets/bbb-dark-truths-hls/hls.m3u8';
// Keep the legacy seeded-sample identifier stable for deployment cleanup, but
// probe release egress with a direct HTTPS file so ffprobe/ffmpeg do not rely
// on HTTPS HLS proxy traversal during Actions diagnostics.
export const HEARMEOUT_MEDIA_DIAGNOSTIC_SOURCE = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_v-0480p-1000k-libx264.mp4';
export const HEARMEOUT_TEST_TITLE = 'Shaka demo — deployment playback check';
