import assert from 'node:assert/strict';
import test from 'node:test';
import {HEARMEOUT_MEDIA_DIAGNOSTIC_SOURCE, HEARMEOUT_TEST_SOURCE} from '../scripts/sprites/hearmeout-test-source.mjs';

test('release media diagnostics use a direct HTTPS file without changing the legacy cleanup sample',()=>{
 assert.match(HEARMEOUT_TEST_SOURCE,/^https:\/\/storage\.googleapis\.com\/shaka-demo-assets\/.+\.m3u8$/);
 assert.match(HEARMEOUT_MEDIA_DIAGNOSTIC_SOURCE,/^https:\/\/storage\.googleapis\.com\/shaka-demo-assets\/.+\.mp4$/);
 assert.notEqual(HEARMEOUT_MEDIA_DIAGNOSTIC_SOURCE,HEARMEOUT_TEST_SOURCE);
});
