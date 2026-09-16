import assert from 'node:assert/strict';
import test from 'node:test';
import {broadcastView,renderHearMeOutBroadcastWindow} from '../apps/hearmeout/dist/broadcast-window.js';

function programFixture(){
  return {
    binding:{tenantId:'tenant'},
    getSession(){return {revision:1,playback:{status:'playing',position:0,updatedAt:new Date().toISOString(),muted:false,volume:100},current:{requestId:'one',item:{itemId:'abcdefghijk',type:'music',title:'Music video',source:'youtube',playbackUrl:'https://rr1.googlevideo.com/video',metadata:{videoId:'abcdefghijk',audioPlaybackUrl:'https://rr1.googlevideo.com/private-audio'}}},queue:[{requestId:'two',item:{itemId:'two',type:'music',title:'Next',source:'youtube',playbackUrl:'https://rr1.googlevideo.com/video2',metadata:{audioPlaybackUrl:'https://rr1.googlevideo.com/private-audio2'}}}]};}
  };
}

test('broadcast window exposes local audio/video toggles without exposing signed audio inputs',()=>{
  const html=renderHearMeOutBroadcastWindow('client');
  assert.match(html,/id="audio-toggle"/);assert.match(html,/id="video-toggle"/);
  assert.match(html,/class="viewer-controls"/);assert.match(html,/main:hover \.viewer-controls/);
  assert.match(html,/@media\(hover:none\)/);
  assert.match(html,/video\.muted=!audioEnabled/);assert.match(html,/classList\.toggle\('video-off',!videoEnabled\)/);
  assert.doesNotMatch(html,/addEventListener\('canplay',\(\)=>\{[^}]*source\.joinLive/);assert.match(html,/source\.syncLive\(\)/);
  assert.match(html,/if\(!state\.broadcast\.ready\)\{if\(!sourceUrl\)/);
  assert.doesNotMatch(html,/!state\.broadcast\.ready\)\{if\(sourceUrl\)\{sourceUrl='';source\.clear\(\)/);
  assert.match(html,/broadcast connection was interrupted\. Reconnecting automatically/);
  assert.match(html,/statePollFailed\)\{error\.textContent='';statePollFailed=false/);
  assert.match(html,/addEventListener\('playing'.*playbackError\.textContent=''/);
  assert.doesNotMatch(html,/\/api\/watch\/broadcast\/control[^]*audio-toggle/);
  const view=broadcastView(programFixture(),true,false,undefined,'party-room');
  assert.equal(view.current.item.metadata.videoId,'abcdefghijk');
  assert.equal(view.current.item.metadata.audioPlaybackUrl,undefined);
  assert.equal(view.queue[0].item.metadata?.audioPlaybackUrl,undefined);
  assert.doesNotMatch(JSON.stringify(view),/private-audio/);
  assert.equal(view.broadcast.playbackUrl,'/api/watch/sessions/party-room/broadcast/index.m3u8');
});
