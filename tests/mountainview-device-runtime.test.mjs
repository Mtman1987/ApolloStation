import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteMountainViewDeviceStore, buildMountainViewPairingPayload, planMountainViewQrRoute } from "../apps/mountainview/dist/index.js";

test("MountainView pairs tenant/user scoped devices with explicit capabilities and restart persistence",()=>{
  const dir=mkdtempSync(join(tmpdir(),"mountainview-")),db=join(dir,"mv.sqlite");let store=new SqliteMountainViewDeviceStore(db);
  const device=store.pair({tenantId:"tenant-a",userId:"user-a",deviceId:"phone-1",name:"Captain Phone",kind:"phone",capabilities:["voice","camera","qr"],now:"2026-08-26T12:00:00Z"});
  assert.equal(device.kind,"phone");assert.deepEqual(device.capabilities,["voice","camera","qr"]);store.close();store=new SqliteMountainViewDeviceStore(db);assert.equal(store.list("tenant-a","user-a")[0].deviceId,"phone-1");assert.equal(store.list("tenant-b","user-a").length,0);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("MountainView records QR and camera captures only for authorized active devices",()=>{
  const dir=mkdtempSync(join(tmpdir(),"mountainview-capture-")),store=new SqliteMountainViewDeviceStore(join(dir,"mv.sqlite"));
  store.pair({tenantId:"tenant-a",userId:"user-a",deviceId:"glasses-1",name:"Glasses",kind:"glasses",capabilities:["camera","qr"]});
  const qr=store.recordQr({tenantId:"tenant-a",userId:"user-a",deviceId:"glasses-1",value:"spmt:commlink/desk/alpha",now:"2026-08-26T12:00:00Z"});assert.equal(qr.type,"qr.scanned");assert.equal(planMountainViewQrRoute(qr).kind,"ecosystem-deeplink");
  const camera=store.recordCamera({tenantId:"tenant-a",userId:"user-a",deviceId:"glasses-1",mediaUrl:"https://media.example/frame.jpg",width:1920,height:1080});assert.equal(camera.payload.width,1920);assert.equal(store.listCaptures("tenant-a","user-a").length,2);
  store.revoke("tenant-a","user-a","glasses-1");assert.throws(()=>store.recordQr({tenantId:"tenant-a",userId:"user-a",deviceId:"glasses-1",value:"hello"}),/not actively paired/);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("MountainView QR web routes require confirmation while ecosystem deep links do not",()=>{
  const dir=mkdtempSync(join(tmpdir(),"mountainview-qr-")),store=new SqliteMountainViewDeviceStore(join(dir,"mv.sqlite"));store.pair({tenantId:"tenant-a",userId:"user-a",deviceId:"phone-1",name:"Phone",kind:"phone",capabilities:["qr"]});
  const event=store.recordQr({tenantId:"tenant-a",userId:"user-a",deviceId:"phone-1",value:"https://example.com/path"});const plan=planMountainViewQrRoute(event);assert.equal(plan.kind,"open-url");assert.equal(plan.requiresConfirmation,true);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("MountainView pairing payload is short-lived identity scoped data, not a credential",()=>{
  const payload=buildMountainViewPairingPayload({publicOrigin:"https://spmt.live/",tenantId:"tenant-a",userId:"user-a",pairingCode:"ABC123",expiresAt:"2026-08-26T12:10:00Z"});assert.equal(payload.kind,"mountainview-pairing");assert.match(payload.url,/mountainview\/pair\?code=ABC123/);assert.equal(payload.tenantId,"tenant-a");assert.throws(()=>buildMountainViewPairingPayload({...payload,publicOrigin:"http://spmt.live/",pairingCode:"ABC123"}),/HTTPS/);
});
