import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AsyncStreamWeaverGenerationStore} from "../apps/streamweaver/dist/async-generation-settings.js";
test("async generation settings persist scoped settings, catalog and job checkpoints across restart",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-generation-")),databasePath=join(directory,"records.sqlite");
 const store=new AsyncStreamWeaverGenerationStore({mode:"sqlite",databasePath});await store.initialize();
 try{
  const saved=await store.save("tenant-a","public",{provider:"cloudflare",cloudflareModel:"@cf/black-forest-labs/flux-1-schnell",publicAccess:"mods",count:2});
  assert.equal(saved.publicAccess,"mods");assert.equal((await store.read("tenant-b")).publicAccess,"everyone");
  await store.save("tenant-a","private:user-a",{provider:"pollinations",pollinationsModel:"flux"});
  await store.saveCatalog([{provider:"cloudflare",id:"model-a",label:"Model A"}]);
  await store.saveGenerated("tenant-a","job-1",{provider:"cloudflare",resourceUrls:["https://example.com/image.png"]});
  await store.saveGenerated("tenant-a","job-1",{provider:"other",resourceUrls:[]});
  assert.equal((await store.generated("tenant-a","job-1")).provider,"cloudflare");
  await store.close();
  const reopened=new AsyncStreamWeaverGenerationStore({mode:"sqlite",databasePath});await reopened.initialize();
  try{assert.equal((await reopened.read("tenant-a","private:user-a")).pollinationsModel,"flux");assert.equal((await reopened.catalog()).models[0].id,"model-a");assert.equal((await reopened.generated("tenant-a","job-1")).provider,"cloudflare");assert.equal(await reopened.generated("tenant-b","job-1"),undefined);}finally{await reopened.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
});
test("async generation settings reject unsafe public-only model and invalid scopes",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-generation-")),databasePath=join(directory,"records.sqlite"),store=new AsyncStreamWeaverGenerationStore({mode:"sqlite",databasePath});await store.initialize();
 try{await assert.rejects(store.save("tenant-a","public",{provider:"cloudflare",cloudflareModel:"@cf/black-forest-labs/klein-9b"}),/restricted to private/);await assert.rejects(store.save("tenant-a","private:bad scope",{provider:"automatic"}),/scope/);}finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
