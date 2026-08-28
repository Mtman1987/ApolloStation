import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HEARMEOUT_DIRECT_VOD_CHUNK_BYTES, HEARMEOUT_YOUTUBE_INFO_TTL_MS, HearMeOutYoutubeResolverCoordinator, acceptHearMeOutBrowserResolvedStream, isHearMeOutYoutubeInfoFresh, parseHearMeOutByteRange, writeHearMeOutYoutubeCookiesBase64 } from "../apps/hearmeout/dist/index.js";

const videoId="abcdefghijk";
const media=(stage)=>({videoId,videoUrl:"https://rr1.googlevideo.com/video",audioUrl:"https://rr1.googlevideo.com/audio",stage,resolvedAt:"2026-08-26T12:00:00Z"});

test("HearMeOut resolver preserves cache -> yt-dlp -> anonymous -> upstream -> youtubei -> browser -> chromium order",async()=>{
  const calls=[];const adapter={cache:async()=>{calls.push("cache");return null;},ytDlp:async(_id,{useCookies})=>{calls.push(useCookies?"yt-dlp":"yt-dlp-anonymous");return null;},upstream:async()=>{calls.push("upstream");return null;},youtubei:async()=>{calls.push("youtubei");return null;},browserResolved:async()=>{calls.push("browser-resolved");return media("browser-resolved");},chromium:async()=>{calls.push("chromium");return media("chromium");}};
  const coordinator=new HearMeOutYoutubeResolverCoordinator(adapter,{cookiesAvailable:()=>true,now:()=>"2026-08-26T12:00:00Z"});const result=await coordinator.resolve(videoId);assert.equal(result.result.stage,"browser-resolved");assert.deepEqual(calls,["cache","yt-dlp","yt-dlp-anonymous","upstream","youtubei","browser-resolved"]);
});

test("HearMeOut resolver continues after a failed stage and redacts resolver errors",async()=>{
  const coordinator=new HearMeOutYoutubeResolverCoordinator({cache:async()=>null,ytDlp:async()=>{throw new Error("token=secret extraction failed");},upstream:async()=>media("upstream")},{cookiesAvailable:()=>false});const result=await coordinator.resolve(videoId);assert.equal(result.result.stage,"upstream");assert.equal(result.attempts[1].outcome,"error");assert.doesNotMatch(result.attempts[1].message,/secret/);
});

test("HearMeOut accepts only allowlisted HTTPS browser-resolved YouTube media URLs",()=>{
  const accepted=acceptHearMeOutBrowserResolvedStream({videoId,videoUrl:"https://r1.googlevideo.com/v",audioUrl:"https://r1.googlevideo.com/a",title:"Track",durationMs:1234},"2026-08-26T12:00:00Z");assert.equal(accepted.stage,"browser-resolved");assert.throws(()=>acceptHearMeOutBrowserResolvedStream({videoId,videoUrl:"https://evil.example/v",audioUrl:"https://r1.googlevideo.com/a"}),/not allowed/);
});

test("HearMeOut writes base64 cookie material mode 0600 without exposing content",()=>{
  const dir=mkdtempSync(join(tmpdir(),"hmo-cookies-")),path=join(dir,"cookies.txt"),body="# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n";const result=writeHearMeOutYoutubeCookiesBase64(Buffer.from(body).toString("base64"),path);assert.equal(result.bytes,Buffer.byteLength(body));assert.equal(statSync(path).mode&0o777,0o600);assert.equal(readFileSync(path,"utf8"),body);rmSync(dir,{recursive:true,force:true});
});

test("HearMeOut direct VOD ranges are bounded to 8 MiB by default and support suffix ranges",()=>{
  assert.equal(HEARMEOUT_DIRECT_VOD_CHUNK_BYTES,8*1024*1024);const whole=parseHearMeOutByteRange(undefined,20*1024*1024);assert.equal(whole.length,8*1024*1024);assert.equal(whole.start,0);const suffix=parseHearMeOutByteRange("bytes=-100",1000);assert.deepEqual({start:suffix.start,end:suffix.end,length:suffix.length},{start:900,end:999,length:100});assert.throws(()=>parseHearMeOutByteRange("bytes=2000-",1000),/Unsatisfiable/);
});

test("HearMeOut YouTube metadata freshness keeps the donor five-hour cache window",()=>{
  const start=Date.parse("2026-08-26T00:00:00Z");assert.equal(HEARMEOUT_YOUTUBE_INFO_TTL_MS,5*60*60*1000);assert.equal(isHearMeOutYoutubeInfoFresh("2026-08-26T00:00:00Z",start+HEARMEOUT_YOUTUBE_INFO_TTL_MS-1),true);assert.equal(isHearMeOutYoutubeInfoFresh("2026-08-26T00:00:00Z",start+HEARMEOUT_YOUTUBE_INFO_TTL_MS),false);
});
