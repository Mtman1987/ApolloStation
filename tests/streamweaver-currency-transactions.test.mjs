import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {MemoryStreamWeaverEconomyStore,SqliteStreamWeaverEconomyStore,StreamWeaverEconomy,StreamWeaverAdminEconomy} from "../apps/streamweaver/dist/index.js";

for(const implementation of [MemoryStreamWeaverEconomyStore,SqliteStreamWeaverEconomyStore])test(`${implementation.name} commits balances and receipts together and rolls both back on failure`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-currency-atomic-"));
  class Store extends implementation { fail=false;putReceipt(...args){super.putReceipt(...args);if(this.fail)throw new Error("Receipt storage failed");} }
  const store=new Store(join(dir,"currency.sqlite")),economy=new StreamWeaverEconomy({tenantId:"a",store,random:()=>0,nowMs:()=>100000000});
  try{
    economy.configureCurrency({currencyName:"Stars"});store.setBalance("a","captain",1000);store.fail=true;
    await assert.rejects(()=>economy.gamble({userId:"captain",operationId:"gamble",bet:100}),/Receipt storage failed/);
    assert.equal(store.getWallet("a","captain").balance,1000);assert.equal(store.getReceipt("a","gamble"),undefined);assert.equal(store.getGlobalJackpotAt(),0);
    if(store.listLedger)assert.ok(!store.listLedger("a").some(row=>row.operationId==="gamble"));
    store.fail=false;const result=await economy.gamble({userId:"captain",operationId:"gamble",bet:100});assert.equal(result.outcome,"jackpot");
    const balance=store.getWallet("a","captain").balance;assert.equal((await economy.gamble({userId:"captain",operationId:"gamble",bet:100})).duplicate,true);assert.equal(store.getWallet("a","captain").balance,balance);
    if(store.listLedger)assert.equal(store.listLedger("a").filter(row=>row.operationId==="gamble").length,1);
  }finally{store.close?.();rmSync(dir,{recursive:true,force:true});}
});

test("bulk currency adjustments are atomic, retain their original recipients and reject conflicting retries",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-bulk-currency-")),store=new SqliteStreamWeaverEconomyStore(join(dir,"currency.sqlite"));let users=["one","two"];
  const admin=new StreamWeaverAdminEconomy(store,"a",{listCanonicalUserIds:()=>users});
  try{
    store.setBalance("a","one",50);store.setBalance("a","two",0);store.setBalance("b","one",99);
    await assert.rejects(()=>admin.addToAll(-10,"bad-bulk",{actorId:"owner"}),/balance/);assert.equal(store.getWallet("a","one").balance,50);assert.ok(!store.listLedger("a").some(row=>row.operationId==="bad-bulk"));
    assert.equal(await admin.addToAll(5,"bulk",{actorId:"owner"}),2);users.push("three");assert.equal(await admin.addToAll(5,"bulk",{actorId:"owner"}),2);
    assert.equal(store.getWallet("a","one").balance,55);assert.equal(store.getWallet("a","three").balance,0);assert.equal(store.getWallet("b","one").balance,99);
    await assert.rejects(()=>admin.addToAll(6,"bulk",{actorId:"owner"}),/different values/);
    await assert.rejects(()=>admin.addPoints("one",1.2,"fraction"),/safe integer/);
    const entries=store.listLedger("a").filter(row=>row.operationId==="bulk");assert.equal(entries.length,2);assert.ok(entries.every(row=>row.actorId==="owner"&&row.reason==="bulk-add"&&row.delta===5));
    const first=store.listLedger("a",{limit:1})[0],next=store.listLedger("a",{limit:1,before:first.id})[0];assert.ok(next.id<first.id);assert.ok(store.listLedger("a",{userId:"one"}).every(row=>row.userId==="one"));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("configured zero and full win percentages retain their literal meaning",async()=>{
  const store=new MemoryStreamWeaverEconomyStore(),economy=new StreamWeaverEconomy({tenantId:"a",store,random:()=>0});
  economy.configureCurrency({currencyName:"Stars",jackpotPercent:0,winPercent:0});store.setBalance("a","captain",1000);
  assert.equal((await economy.gamble({userId:"captain",operationId:"zero",bet:100})).outcome,"loss");
  const full=new StreamWeaverEconomy({tenantId:"a",store,random:()=>0.999});full.configureCurrency({currencyName:"Stars",winPercent:100,jackpotPercent:0});
  assert.equal((await full.gamble({userId:"captain",operationId:"full",bet:100})).outcome,"win");
});
