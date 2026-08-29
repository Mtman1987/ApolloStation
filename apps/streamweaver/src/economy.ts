import { DatabaseSync } from "node:sqlite";
import { SpmtClient, buildXpIdempotencyKey } from "@spmt/sdk";

export const STREAMWEAVER_STEAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const STREAMWEAVER_MAX_LOCAL_WAGER = 1_000_000_000_000;
export const STREAMWEAVER_MAX_LOCAL_PAYOUT = 100_000_000_000_000;

export interface StreamWeaverGambleSettingsV1 {
  currencyName: string;
  currencyConfigured: boolean;
  defaultBet: number;
  minBet: number;
  maxBet: number;
  jackpotPercent: number;
  jackpotMultiplier: number;
  winPercent: number;
  spmtExchangeEnabled: boolean;
  baseLocalPerSpmt: number;
  referenceSupply: number;
  maxSpmtPerExchange: number;
}

export const DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS: StreamWeaverGambleSettingsV1 = {
  currencyName: "Credits",
  currencyConfigured: false,
  defaultBet: 1234,
  minBet: 0,
  maxBet: 0,
  jackpotPercent: 1,
  jackpotMultiplier: 1,
  winPercent: 28,
  spmtExchangeEnabled: false,
  baseLocalPerSpmt: 1000,
  referenceSupply: 1_000_000,
  maxSpmtPerExchange: 100,
};

export interface StreamWeaverCurrencyWalletV1 { tenantId: string; userId: string; balance: number; totalEarned: number; }
export interface StreamWeaverCurrencyLeaderboardEntryV1 extends StreamWeaverCurrencyWalletV1 { rank: number; }
export interface StreamWeaverCurrencyExchangeV1 {
  schemaVersion: 1; tenantId: string; operationId: string; userId: string; currencyName: string;
  localSpent: number; spmtAwarded: number; localPerSpmt: number; supplyAtQuote: number;
  status: "pending" | "complete"; createdAt: string; completedAt?: string;
}
export type StreamWeaverEconomyReceiptV1 = { operationId: string; kind: "give" | "steal" | "gamble" | "roll"; result: Record<string, unknown>; createdAt: string; };

export interface StreamWeaverEconomyStoreV1 {
  getCooldown(tenantId: string, userId: string): number;
  putCooldown(tenantId: string, userId: string, timestamp: number): void;
  getGlobalJackpotAt(): number;
  putGlobalJackpotAt(timestamp: number): void;
  getReceipt(tenantId: string, operationId: string): StreamWeaverEconomyReceiptV1 | undefined;
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1): void;
  getWallet(tenantId: string, userId: string): StreamWeaverCurrencyWalletV1;
  adjustBalance(tenantId: string, userId: string, delta: number, lifetimeEligible?: boolean): StreamWeaverCurrencyWalletV1;
  setBalance(tenantId: string, userId: string, target: number): StreamWeaverCurrencyWalletV1;
  transfer(tenantId: string, fromUserId: string, toUserId: string, amount: number): { from: StreamWeaverCurrencyWalletV1; to: StreamWeaverCurrencyWalletV1 };
  settleWager(tenantId: string, userId: string, wager: number, payout: number): StreamWeaverCurrencyWalletV1;
  listLeaderboard(tenantId: string, limit: number): StreamWeaverCurrencyLeaderboardEntryV1[];
  listWalletUserIds(tenantId: string): string[];
  getCirculatingSupply(tenantId: string): number;
  getSettings(tenantId: string): StreamWeaverGambleSettingsV1 | undefined;
  putSettings(tenantId: string, settings: StreamWeaverGambleSettingsV1): StreamWeaverGambleSettingsV1;
  getExchange(tenantId: string, operationId: string): StreamWeaverCurrencyExchangeV1 | undefined;
  reserveExchange(input: StreamWeaverCurrencyExchangeV1): StreamWeaverCurrencyExchangeV1;
  completeExchange(tenantId: string, operationId: string, completedAt: string): StreamWeaverCurrencyExchangeV1;
}

export class MemoryStreamWeaverEconomyStore implements StreamWeaverEconomyStoreV1 {
  private readonly cooldowns = new Map<string, number>();
  private readonly receipts = new Map<string, StreamWeaverEconomyReceiptV1>();
  private readonly wallets = new Map<string, StreamWeaverCurrencyWalletV1>();
  private readonly settings = new Map<string, StreamWeaverGambleSettingsV1>();
  private readonly exchanges = new Map<string, StreamWeaverCurrencyExchangeV1>();
  private jackpotAt = 0;
  getCooldown(tenantId: string, userId: string) { return this.cooldowns.get(`${tenantId}:${userId}`) ?? 0; }
  putCooldown(tenantId: string, userId: string, timestamp: number) { this.cooldowns.set(`${tenantId}:${userId}`, timestamp); }
  getGlobalJackpotAt() { return this.jackpotAt; }
  putGlobalJackpotAt(timestamp: number) { this.jackpotAt = timestamp; }
  getReceipt(tenantId: string, operationId: string) { const value = this.receipts.get(`${tenantId}:${operationId}`); return value ? structuredClone(value) : undefined; }
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1) { this.receipts.set(`${tenantId}:${receipt.operationId}`, structuredClone(receipt)); }
  getWallet(tenantId: string, userId: string) { return structuredClone(this.wallets.get(walletKey(tenantId, userId)) ?? emptyWallet(tenantId, userId)); }
  adjustBalance(tenantId: string, userId: string, deltaInput: number, lifetimeEligible = false) {
    const delta = safeDelta(deltaInput, "delta");
    const current = this.getWallet(tenantId, userId);
    const next = { ...current, balance: safeNonNegative(current.balance + delta, "balance"), totalEarned: current.totalEarned + (lifetimeEligible && delta > 0 ? delta : 0) };
    this.wallets.set(walletKey(tenantId, userId), structuredClone(next)); return structuredClone(next);
  }
  setBalance(tenantId: string, userId: string, target: number) {
    const current = this.getWallet(tenantId, userId); const next = { ...current, balance: safeNonNegative(target, "target") };
    this.wallets.set(walletKey(tenantId, userId), structuredClone(next)); return structuredClone(next);
  }
  transfer(tenantId: string, fromUserId: string, toUserId: string, amountInput: number) {
    const amount = positiveAmount(amountInput); const from = this.getWallet(tenantId, fromUserId);
    if (from.balance < amount) throw new Error("insufficient StreamWeaver currency");
    return { from: this.adjustBalance(tenantId, fromUserId, -amount, false), to: this.adjustBalance(tenantId, toUserId, amount, false) };
  }
  settleWager(tenantId: string, userId: string, wagerInput: number, payoutInput: number) {
    const wager = positiveAmount(wagerInput); const payout = safeNonNegative(payoutInput, "payout"); const wallet = this.getWallet(tenantId, userId);
    if (wallet.balance < wager) throw new Error("insufficient StreamWeaver currency");
    const delta = payout - wager; return this.adjustBalance(tenantId, userId, delta, delta > 0);
  }
  listLeaderboard(tenantId: string, limitInput: number) {
    const limit = boundedLimit(limitInput);
    return [...this.wallets.values()].filter((w) => w.tenantId === tenantId).sort((a,b) => b.balance-a.balance || a.userId.localeCompare(b.userId)).slice(0,limit).map((w,i) => ({...structuredClone(w),rank:i+1}));
  }
  listWalletUserIds(tenantId: string) { return [...this.wallets.values()].filter((wallet) => wallet.tenantId === tenantId).map((wallet) => wallet.userId).sort(); }
  getCirculatingSupply(tenantId: string) {
    let total=0; for(const w of this.wallets.values()) if(w.tenantId===tenantId) total+=w.balance;
    for(const e of this.exchanges.values()) if(e.tenantId===tenantId&&e.status==="pending") total+=e.localSpent; return total;
  }
  getSettings(tenantId: string) { const v=this.settings.get(tenantId); return v?structuredClone(v):undefined; }
  putSettings(tenantId: string, settings: StreamWeaverGambleSettingsV1) { const v=normalizeSettings(settings); this.settings.set(tenantId,structuredClone(v)); return structuredClone(v); }
  getExchange(tenantId: string, operationId: string) { const v=this.exchanges.get(`${tenantId}:${operationId}`); return v?structuredClone(v):undefined; }
  reserveExchange(input: StreamWeaverCurrencyExchangeV1) {
    const key=`${input.tenantId}:${input.operationId}`; const old=this.exchanges.get(key); if(old)return structuredClone(old);
    if(this.getWallet(input.tenantId,input.userId).balance<input.localSpent)throw new Error("insufficient StreamWeaver currency for exchange");
    this.adjustBalance(input.tenantId,input.userId,-input.localSpent,false); this.exchanges.set(key,structuredClone(input)); return structuredClone(input);
  }
  completeExchange(tenantId: string, operationId: string, completedAt: string) {
    const key=`${tenantId}:${operationId}`; const old=this.exchanges.get(key); if(!old)throw new Error("StreamWeaver exchange not found");
    const next={...old,status:"complete" as const,completedAt:validTimestamp(completedAt,"completedAt")}; this.exchanges.set(key,structuredClone(next)); return structuredClone(next);
  }
}

export class SqliteStreamWeaverEconomyStore implements StreamWeaverEconomyStoreV1 {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if(!path)throw new Error("StreamWeaver economy database path is required"); this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS streamweaver_economy_state(state_key TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS streamweaver_currency_wallet(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),total_earned INTEGER NOT NULL DEFAULT 0 CHECK(total_earned>=0),updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id)) STRICT;
CREATE TABLE IF NOT EXISTS streamweaver_currency_settings(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS streamweaver_currency_exchange(tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','complete')),local_spent INTEGER NOT NULL CHECK(local_spent>0),updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,operation_id)) STRICT;`);
  }
  close(){this.db.close();}
  getCooldown(t:string,u:string){return Number(this.read(`cooldown:${t}:${u}`)?.timestamp??0);} putCooldown(t:string,u:string,x:number){this.write(`cooldown:${t}:${u}`,{timestamp:x});}
  getGlobalJackpotAt(){return Number(this.read("global:jackpot")?.timestamp??0);} putGlobalJackpotAt(x:number){this.write("global:jackpot",{timestamp:x});}
  getReceipt(t:string,o:string){return this.read(`receipt:${t}:${o}`) as StreamWeaverEconomyReceiptV1|undefined;} putReceipt(t:string,r:StreamWeaverEconomyReceiptV1){this.write(`receipt:${t}:${r.operationId}`,r);}
  getWallet(tenantIdInput:string,userIdInput:string){const tenantId=requireText(tenantIdInput,"tenantId"),userId=requireText(userIdInput,"userId");const r=this.db.prepare("SELECT balance,total_earned FROM streamweaver_currency_wallet WHERE tenant_id=? AND user_id=?").get(tenantId,userId) as {balance:number;total_earned:number}|undefined;return r?{tenantId,userId,balance:Number(r.balance),totalEarned:Number(r.total_earned)}:emptyWallet(tenantId,userId);}
  adjustBalance(t:string,u:string,d:number,l=false){return this.tx(()=>{const c=this.getWallet(t,u),delta=safeDelta(d,"delta"),n={...c,balance:safeNonNegative(c.balance+delta,"balance"),totalEarned:c.totalEarned+(l&&delta>0?delta:0)};this.upsert(n);return n;});}
  setBalance(t:string,u:string,target:number){return this.tx(()=>{const c=this.getWallet(t,u),n={...c,balance:safeNonNegative(target,"target")};this.upsert(n);return n;});}
  transfer(t:string,f:string,to:string,a:number){return this.tx(()=>{const amount=positiveAmount(a),from=this.getWallet(t,f),dest=this.getWallet(t,to);if(from.balance<amount)throw new Error("insufficient StreamWeaver currency");const nf={...from,balance:from.balance-amount},nt={...dest,balance:dest.balance+amount};this.upsert(nf);this.upsert(nt);return{from:nf,to:nt};});}
  settleWager(t:string,u:string,w:number,p:number){return this.tx(()=>{const wager=positiveAmount(w),payout=safeNonNegative(p,"payout"),c=this.getWallet(t,u);if(c.balance<wager)throw new Error("insufficient StreamWeaver currency");const delta=payout-wager,n={...c,balance:c.balance+delta,totalEarned:c.totalEarned+Math.max(0,delta)};this.upsert(n);return n;});}
  listLeaderboard(t:string,l:number){const tenantId=requireText(t,"tenantId"),limit=boundedLimit(l);const rows=this.db.prepare("SELECT user_id,balance,total_earned FROM streamweaver_currency_wallet WHERE tenant_id=? ORDER BY balance DESC,user_id ASC LIMIT ?").all(tenantId,limit) as {user_id:string;balance:number;total_earned:number}[];return rows.map((r,i)=>({tenantId,userId:r.user_id,balance:Number(r.balance),totalEarned:Number(r.total_earned),rank:i+1}));}
  listWalletUserIds(t:string){const tenantId=requireText(t,"tenantId");return (this.db.prepare("SELECT user_id AS userId FROM streamweaver_currency_wallet WHERE tenant_id=? ORDER BY user_id").all(tenantId) as Array<{userId:string}>).map((row)=>row.userId);}
  getCirculatingSupply(t:string){const tenantId=requireText(t,"tenantId");const w=this.db.prepare("SELECT COALESCE(SUM(balance),0) total FROM streamweaver_currency_wallet WHERE tenant_id=?").get(tenantId) as {total:number};const p=this.db.prepare("SELECT COALESCE(SUM(local_spent),0) total FROM streamweaver_currency_exchange WHERE tenant_id=? AND status='pending'").get(tenantId) as {total:number};return Number(w.total??0)+Number(p.total??0);}
  getSettings(t:string){const tenantId=requireText(t,"tenantId"),r=this.db.prepare("SELECT body FROM streamweaver_currency_settings WHERE tenant_id=?").get(tenantId) as {body:string}|undefined;return r?normalizeSettings(JSON.parse(r.body) as StreamWeaverGambleSettingsV1):undefined;}
  putSettings(t:string,s:StreamWeaverGambleSettingsV1){const tenantId=requireText(t,"tenantId"),v=normalizeSettings(s);this.db.prepare("INSERT INTO streamweaver_currency_settings(tenant_id,body,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(tenantId,JSON.stringify(v),new Date().toISOString());return v;}
  getExchange(t:string,o:string){const tenantId=requireText(t,"tenantId"),operationId=requireText(o,"operationId"),r=this.db.prepare("SELECT body FROM streamweaver_currency_exchange WHERE tenant_id=? AND operation_id=?").get(tenantId,operationId) as {body:string}|undefined;return r?JSON.parse(r.body) as StreamWeaverCurrencyExchangeV1:undefined;}
  reserveExchange(input:StreamWeaverCurrencyExchangeV1){return this.tx(()=>{const old=this.getExchange(input.tenantId,input.operationId);if(old)return old;const w=this.getWallet(input.tenantId,input.userId);if(w.balance<input.localSpent)throw new Error("insufficient StreamWeaver currency for exchange");this.upsert({...w,balance:w.balance-input.localSpent});this.db.prepare("INSERT INTO streamweaver_currency_exchange(tenant_id,operation_id,user_id,body,status,local_spent,updated_at) VALUES(?,?,?,?,?,?,?)").run(input.tenantId,input.operationId,input.userId,JSON.stringify(input),input.status,input.localSpent,input.createdAt);return input;});}
  completeExchange(t:string,o:string,at:string){const tenantId=requireText(t,"tenantId"),operationId=requireText(o,"operationId"),completedAt=validTimestamp(at,"completedAt");return this.tx(()=>{const old=this.getExchange(tenantId,operationId);if(!old)throw new Error("StreamWeaver exchange not found");if(old.status==="complete")return old;const n={...old,status:"complete" as const,completedAt};this.db.prepare("UPDATE streamweaver_currency_exchange SET body=?,status='complete',updated_at=? WHERE tenant_id=? AND operation_id=?").run(JSON.stringify(n),completedAt,tenantId,operationId);return n;});}
  private upsert(w:StreamWeaverCurrencyWalletV1){this.db.prepare("INSERT INTO streamweaver_currency_wallet(tenant_id,user_id,balance,total_earned,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET balance=excluded.balance,total_earned=excluded.total_earned,updated_at=excluded.updated_at").run(w.tenantId,w.userId,w.balance,w.totalEarned,new Date().toISOString());}
  private read(k:string){const r=this.db.prepare("SELECT body FROM streamweaver_economy_state WHERE state_key=?").get(k) as {body:string}|undefined;return r?JSON.parse(r.body) as Record<string,unknown>:undefined;}
  private write(k:string,v:unknown){this.db.prepare("INSERT INTO streamweaver_economy_state(state_key,body,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(k,JSON.stringify(v),new Date().toISOString());}
  private tx<T>(fn:()=>T){this.db.exec("BEGIN IMMEDIATE");try{const v=fn();this.db.exec("COMMIT");return v;}catch(e){this.db.exec("ROLLBACK");throw e;}}
}

const HEIST_SCENARIOS=[
  {success:"slipped past the security lasers and grabbed the loot",fail:"triggered the alarm and had to flee empty-handed",partial:"grabbed what they could before the guards arrived"},
  {success:"hacked the vault and transferred the credits",fail:"got caught in the firewall and lost their connection",partial:"managed to grab some data before getting disconnected"},
  {success:"teleported in, snatched the goods, and vanished",fail:"miscalculated the coordinates and ended up in the wrong sector",partial:"grabbed a handful before the teleporter malfunctioned"},
  {success:"sweet-talked the AI guardian and walked away with everything",fail:"got outsmarted by the AI and ejected from the station",partial:"charmed their way to a small share before being escorted out"},
  {success:"used a cloaking device and cleaned out the vault",fail:"the cloak failed and they were spotted immediately",partial:"the cloak flickered, forcing a quick grab-and-run"},
] as const;

export interface StreamWeaverEconomyOptionsV1 { client?: SpmtClient; tenantId:string; store:StreamWeaverEconomyStoreV1; nowMs?:()=>number; random?:()=>number; settings?:Partial<StreamWeaverGambleSettingsV1>; }

export class StreamWeaverEconomy {
  private readonly client: SpmtClient | undefined;
  private readonly tenantId:string; private readonly store:StreamWeaverEconomyStoreV1; private readonly nowMs:()=>number; private readonly random:()=>number;
  constructor(options:StreamWeaverEconomyOptionsV1){this.client=options.client;this.tenantId=requireText(options.tenantId,"tenantId");this.store=options.store;this.nowMs=options.nowMs??Date.now;this.random=options.random??Math.random;if(options.settings){const c=this.store.getSettings(this.tenantId)??DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;const named=typeof options.settings.currencyName==="string"&&options.settings.currencyName.trim().length>0;this.store.putSettings(this.tenantId,normalizeSettings({...c,...options.settings,currencyConfigured:options.settings.currencyConfigured??(named?true:c.currencyConfigured)}));}}
  configureCurrency(input:{currencyName:string;spmtExchangeEnabled?:boolean;baseLocalPerSpmt?:number;referenceSupply?:number;maxSpmtPerExchange?:number;defaultBet?:number;minBet?:number;maxBet?:number;jackpotPercent?:number;jackpotMultiplier?:number;winPercent?:number}){const c=this.store.getSettings(this.tenantId)??DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;return this.store.putSettings(this.tenantId,normalizeSettings({...c,...input,currencyName:validateStreamWeaverCurrencyName(input.currencyName),currencyConfigured:true}));}
  getCurrencySettings(){return normalizeSettings(this.store.getSettings(this.tenantId)??DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS);} currencyName(){return this.requireSettings().currencyName;}
  points(userId:string){this.requireSettings();return this.store.getWallet(this.tenantId,requireText(userId,"userId"));} leaderboard(limit=10){this.requireSettings();return this.store.listLeaderboard(this.tenantId,limit);}
  async givePoints(input:{fromUserId:string;toUserId:string;fromDisplayName?:string;toDisplayName?:string;amount:number;operationId:string}){const s=this.requireSettings(),from=requireText(input.fromUserId,"fromUserId"),to=requireText(input.toUserId,"toUserId"),op=requireText(input.operationId,"operationId"),old=this.store.getReceipt(this.tenantId,op);if(old)return{duplicate:true,...old.result};if(from===to)return{success:false,duplicate:false,message:`@${input.fromDisplayName??from}, you can't give ${s.currencyName} to yourself!`};const amount=positiveAmount(input.amount),w=this.store.getWallet(this.tenantId,from);if(w.balance<amount)return{success:false,duplicate:false,message:`@${input.fromDisplayName??from}, you only have ${formatCompactPointAmount(w.balance)} ${s.currencyName}!`};this.store.transfer(this.tenantId,from,to,amount);const result={success:true,message:`@${input.fromDisplayName??from} gave ${formatCompactPointAmount(amount)} ${s.currencyName} to @${input.toDisplayName??to}! 💝`,amount};this.receipt(op,"give",result);return{duplicate:false,...result};}
  async stealPoints(input:{fromUserId:string;toUserId:string;fromDisplayName?:string;toDisplayName?:string;amount:number;operationId:string}){const s=this.requireSettings(),from=requireText(input.fromUserId,"fromUserId"),to=requireText(input.toUserId,"toUserId"),op=requireText(input.operationId,"operationId"),old=this.store.getReceipt(this.tenantId,op);if(old)return{duplicate:true,...old.result};const fn=input.fromDisplayName??from,tn=input.toDisplayName??to;if(from===to)return{success:false,duplicate:false,message:`@${fn}, you can't steal from yourself!`};const amount=positiveAmount(input.amount);if(amount>STREAMWEAVER_MAX_LOCAL_WAGER)return{success:false,duplicate:false,message:`@${fn}, that ${s.currencyName} amount is too large for one heist.`};const now=this.nowMs(),last=this.store.getCooldown(this.tenantId,from);if(last>0&&now-last<STREAMWEAVER_STEAL_COOLDOWN_MS)return{success:false,duplicate:false,message:`@${fn}, you're on cooldown! Wait ${Math.ceil((STREAMWEAVER_STEAL_COOLDOWN_MS-(now-last))/60000)} more minutes.`};const fw=this.store.getWallet(this.tenantId,from),tw=this.store.getWallet(this.tenantId,to);if(fw.balance<amount)return{success:false,duplicate:false,message:`@${fn}, you can only risk ${s.currencyName} you already have. You have ${formatCompactPointAmount(fw.balance)}.`};if(tw.balance<amount)return{success:false,duplicate:false,message:`@${fn}, @${tn} only has ${formatCompactPointAmount(tw.balance)} ${s.currencyName}!`};const roll=this.random()*100,scenario=HEIST_SCENARIOS[Math.min(HEIST_SCENARIOS.length-1,Math.floor(this.random()*HEIST_SCENARIOS.length))]!;let outcome:"success"|"partial"|"fail"|"critical-fail"|"catastrophic-fail",pointsChanged=0,message:string;if(roll<25){outcome="success";pointsChanged=amount;this.store.transfer(this.tenantId,to,from,amount);message=`@${fn} ${scenario.success}! Stole ${formatCompactPointAmount(amount)} ${s.currencyName} from @${tn}! 💰`;}else if(roll<55){outcome="partial";pointsChanged=Math.floor(amount/2);if(pointsChanged)this.store.transfer(this.tenantId,to,from,pointsChanged);message=`@${fn} ${scenario.partial}! Got ${formatCompactPointAmount(pointsChanged)} ${s.currencyName} from @${tn}! 💸`;}else if(roll<80){outcome="fail";message=`@${fn} ${scenario.fail}! No ${s.currencyName} stolen. 😅`;}else{outcome=roll<95?"critical-fail":"catastrophic-fail";pointsChanged=Math.min(amount,fw.balance);if(pointsChanged)this.store.adjustBalance(this.tenantId,from,-pointsChanged,false);message=`@${fn} ${scenario.fail}! Lost ${formatCompactPointAmount(pointsChanged)} ${s.currencyName} in the ${outcome==="critical-fail"?"attempt":"catastrophic failure"}! ${outcome==="critical-fail"?"💥":"💀"}`;}this.store.putCooldown(this.tenantId,from,now);const result={success:true,outcome,pointsChanged,message};this.receipt(op,"steal",result);return{duplicate:false,...result};}
  async gamble(input:{userId:string;displayName?:string;bet?:string|number;operationId:string}){const s=this.requireSettings(),userId=requireText(input.userId,"userId"),op=requireText(input.operationId,"operationId"),old=this.store.getReceipt(this.tenantId,op);if(old)return{duplicate:true,...old.result};const wallet=this.store.getWallet(this.tenantId,userId),bet=parseBetAmount(input.bet,wallet.balance,s,this.random);if(bet>wallet.balance)throw new Error(`you can't bet ${formatCompactPointAmount(bet)} ${s.currencyName}; only ${formatCompactPointAmount(wallet.balance)} is available`);if(bet>STREAMWEAVER_MAX_LOCAL_WAGER)throw new Error(`local wager cap is ${STREAMWEAVER_MAX_LOCAL_WAGER}`);const maxBet=effectiveMaxBet(wallet.balance,s);if(bet>maxBet)throw new Error(`maximum bet is ${formatCompactPointAmount(maxBet)} ${s.currencyName}`);if(s.minBet>0&&bet<s.minBet)throw new Error(`minimum bet is ${formatCompactPointAmount(s.minBet)} ${s.currencyName}`);const roll=Math.floor(this.random()*100)+1,jp=Math.max(1,s.jackpotPercent);let win=Math.max(1,s.winPercent);if(win<jp)win=jp;if(win>=100)win=99;let outcome:"jackpot"|"win"|"loss",change:number;if(roll<=jp&&this.claimJackpot()){outcome="jackpot";change=Math.floor((bet*Math.floor(150+this.random()*100)*Math.max(1,s.jackpotMultiplier))/100);}else if(roll<=win){outcome="win";change=Math.floor((bet*Math.floor(25+this.random()*51))/100);}else{outcome="loss";change=-bet;}const payout=Math.max(0,bet+change);if(payout>STREAMWEAVER_MAX_LOCAL_PAYOUT)throw new Error(`local payout cap is ${STREAMWEAVER_MAX_LOCAL_PAYOUT}`);const newTotal=this.store.settleWager(this.tenantId,userId,bet,payout).balance,name=input.displayName??userId,message=outcome==="loss"?`@${name} lost ${formatCompactPointAmount(bet)} ${s.currencyName}. New total: ${formatCompactPointAmount(newTotal)}.`:outcome==="jackpot"?`🎰 JACKPOT! @${name} won ${formatCompactPointAmount(change)} ${s.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`:`@${name} won ${formatCompactPointAmount(change)} ${s.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`;const result={success:true,outcome,roll,betAmount:bet,change,payout,newTotal,message};this.receipt(op,"gamble",result);return{duplicate:false,...result};}
  async roll(input:{userId:string;displayName?:string;bet:number;operationId:string}){this.requireSettings();const userId=requireText(input.userId,"userId"),op=requireText(input.operationId,"operationId"),old=this.store.getReceipt(this.tenantId,op);if(old)return{duplicate:true,...old.result};const wallet=this.store.getWallet(this.tenantId,userId),bet=positiveAmount(input.bet);if(bet>wallet.balance)throw new Error("insufficient StreamWeaver currency");if(bet>STREAMWEAVER_MAX_LOCAL_WAGER)throw new Error(`local wager cap is ${STREAMWEAVER_MAX_LOCAL_WAGER}`);const die=Math.floor(this.random()*6)+1,outcome=determineRollOutcome(die,bet),payout=Math.max(0,bet+outcome.change),newTotal=this.store.settleWager(this.tenantId,userId,bet,payout).balance,result={success:true,die,outcome:outcome.label,betAmount:bet,change:outcome.change,payout,newTotal,canDouble:die>=4};this.receipt(op,"roll",result);return{duplicate:false,...result};}
  quoteLocalToSpmt(localAmountInput:number){const s=this.requireSettings();if(!s.spmtExchangeEnabled)throw new Error("SPMT exchange is not enabled for this StreamWeaver tenant");const localAmount=positiveAmount(localAmountInput),rate=calculateStreamWeaverExchangeRate(this.store.getCirculatingSupply(this.tenantId),s),spmtAmount=Math.min(Math.floor(localAmount/rate.localPerSpmt),s.maxSpmtPerExchange);if(spmtAmount<1)throw new Error(`at the current supply, at least ${formatCompactPointAmount(rate.localPerSpmt)} ${s.currencyName} is required for 1 SPMT XP`);const localSpent=spmtAmount*rate.localPerSpmt;return{...rate,currencyName:s.currencyName,requestedLocal:localAmount,localSpent,localRemainder:localAmount-localSpent,spmtAmount};}
  async exchangeLocalForSpmt(input:{userId:string;localAmount:number;operationId:string}){const s=this.requireSettings();if(!s.spmtExchangeEnabled)throw new Error("SPMT exchange is not enabled for this StreamWeaver tenant");if(!this.client)throw new Error("SPMT client is required for currency exchange");const userId=requireText(input.userId,"userId"),op=requireText(input.operationId,"operationId");let exchange=this.store.getExchange(this.tenantId,op);if(!exchange){const q=this.quoteLocalToSpmt(input.localAmount);exchange=this.store.reserveExchange({schemaVersion:1,tenantId:this.tenantId,operationId:op,userId,currencyName:s.currencyName,localSpent:q.localSpent,spmtAwarded:q.spmtAmount,localPerSpmt:q.localPerSpmt,supplyAtQuote:q.circulatingSupply,status:"pending",createdAt:new Date(this.nowMs()).toISOString()});}if(exchange.userId!==userId)throw new Error("exchange operation belongs to another user");if(exchange.status==="complete")return{success:true,duplicate:true,pending:false,exchange,wallet:this.store.getWallet(this.tenantId,userId)};const eventType="streamweaver-local-exchange",key=buildXpIdempotencyKey({sourceApp:"streamweaver",eventType,upstreamEventId:op,userId});try{await this.client.awardXp(this.tenantId,userId,exchange.spmtAwarded,eventType,key,{eventType,metadata:{source:"streamweaver-local-currency",currencyName:exchange.currencyName,localSpent:exchange.localSpent,localPerSpmt:exchange.localPerSpmt,supplyAtQuote:exchange.supplyAtQuote}});}catch(error){return{success:false,duplicate:false,pending:true,exchange,message:error instanceof Error?error.message:"SPMT exchange is pending retry"};}const complete=this.store.completeExchange(this.tenantId,op,new Date(this.nowMs()).toISOString());return{success:true,duplicate:false,pending:false,exchange:complete,wallet:this.store.getWallet(this.tenantId,userId)};}
  private requireSettings(){const s=this.getCurrencySettings();if(!s.currencyConfigured)throw new Error("StreamWeaver owner must choose a custom currency name before economy commands can be used");return s;}
  private claimJackpot(){const now=this.nowMs(),prev=this.store.getGlobalJackpotAt();if(prev>0&&now-prev<STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS)return false;this.store.putGlobalJackpotAt(now);return true;}
  private receipt(operationId:string,kind:StreamWeaverEconomyReceiptV1["kind"],result:Record<string,unknown>){this.store.putReceipt(this.tenantId,{operationId,kind,result,createdAt:new Date(this.nowMs()).toISOString()});}
}

export function calculateStreamWeaverExchangeRate(circulatingSupplyInput:number,settingsInput:StreamWeaverGambleSettingsV1){const s=normalizeSettings(settingsInput),circulatingSupply=safeNonNegative(circulatingSupplyInput,"circulatingSupply"),effectiveSupply=Math.max(s.referenceSupply,circulatingSupply),localPerSpmt=Math.max(1,Math.ceil((s.baseLocalPerSpmt*effectiveSupply)/s.referenceSupply));return{circulatingSupply,referenceSupply:s.referenceSupply,baseLocalPerSpmt:s.baseLocalPerSpmt,localPerSpmt,canonicalValueCap:Math.floor(s.referenceSupply/s.baseLocalPerSpmt)};}
export function validateStreamWeaverCurrencyName(value:string){const name=String(value??"").trim();if(name.length<2||name.length>32)throw new Error("currency name must be 2 through 32 characters");if(!/^[\p{L}\p{N}][\p{L}\p{N} '&._-]*$/u.test(name))throw new Error("currency name contains unsupported characters");const reserved=new Set(["xp","spmt","spmts","experience","spacemountain","spacemountainlive"]),tokens=name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);if(tokens.some(t=>reserved.has(t)))throw new Error("currency name cannot use SPMT or XP identity terms");return name;}
export function determineRollOutcome(roll:number,betAmount:number){switch(roll){case 1:return{label:"Total loss!",change:-betAmount};case 2:return{label:"Partial loss",change:-Math.floor(betAmount/2)};case 3:return{label:"Break even",change:0};case 4:return{label:"Small win!",change:Math.floor(betAmount/4)};case 5:return{label:"Nice win!",change:Math.floor(betAmount/2)};case 6:return{label:"Big win!",change:betAmount};default:return{label:"Error",change:0};}}
export function parseStreamWeaverPointAmount(value:string|number):number{if(typeof value==="number")return positiveAmount(value);const raw=value.trim().toLowerCase().replaceAll(",","");const sci=raw.match(/^(\d+)\^(\d+)$/);if(sci){const amount=Number(sci[1])**Number(sci[2]);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("currency amount exceeds safe range");return amount;}const m=raw.match(/^(\d+(?:\.\d+)?)(k|m|b|t)?$/);if(!m)throw new Error("invalid currency amount");const mult=m[2]==="k"?1e3:m[2]==="m"?1e6:m[2]==="b"?1e9:m[2]==="t"?1e12:1;return positiveAmount(Math.floor(Number(m[1])*mult));}
export function formatCompactPointAmount(value:number){const amount=Math.trunc(value),abs=Math.abs(amount),sign=amount<0?"-":"";if(abs>=1e12)return`${sign}${trimCompact(abs/1e12)}T`;if(abs>=1e9)return`${sign}${trimCompact(abs/1e9)}B`;if(abs>=1e6)return`${sign}${trimCompact(abs/1e6)}M`;if(abs>=1e3)return`${sign}${trimCompact(abs/1e3)}K`;return String(amount);}
function normalizeSettings(input:Partial<StreamWeaverGambleSettingsV1>){const m={...DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS,...input},currencyName=m.currencyConfigured?validateStreamWeaverCurrencyName(m.currencyName):String(m.currencyName||DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.currencyName).trim();return{...m,currencyName,currencyConfigured:Boolean(m.currencyConfigured),defaultBet:positiveAmount(m.defaultBet),minBet:safeNonNegative(m.minBet,"minBet"),maxBet:safeNonNegative(m.maxBet,"maxBet"),jackpotPercent:boundedPercent(m.jackpotPercent,"jackpotPercent"),jackpotMultiplier:Math.max(1,safeNonNegative(m.jackpotMultiplier,"jackpotMultiplier")),winPercent:boundedPercent(m.winPercent,"winPercent"),spmtExchangeEnabled:Boolean(m.spmtExchangeEnabled),baseLocalPerSpmt:positiveAmount(m.baseLocalPerSpmt),referenceSupply:positiveAmount(m.referenceSupply),maxSpmtPerExchange:positiveAmount(m.maxSpmtPerExchange)} satisfies StreamWeaverGambleSettingsV1;}
function parseBetAmount(input:string|number|undefined,current:number,s:StreamWeaverGambleSettingsV1,random:()=>number){if(input===undefined||String(input).trim()==="")return positiveAmount(s.defaultBet);if(typeof input==="number")return positiveAmount(input);const u=input.trim().toUpperCase(),max=effectiveMaxBet(current,s);if(u==="ALL")return max;if(u==="HALF")return Math.min(Math.floor(current/2),max);if(u==="QUARTER")return Math.min(Math.floor(current/4),max);if(u==="THIRD")return Math.min(Math.floor(current/3),max);if(u==="RANDOM")return max>0?Math.floor(random()*max)+1:0;return parseStreamWeaverPointAmount(input);}
function effectiveMaxBet(current:number,s:StreamWeaverGambleSettingsV1){return Math.min(current,s.maxBet>0?s.maxBet:STREAMWEAVER_MAX_LOCAL_WAGER,STREAMWEAVER_MAX_LOCAL_WAGER);}
function emptyWallet(t:string,u:string):StreamWeaverCurrencyWalletV1{return{tenantId:requireText(t,"tenantId"),userId:requireText(u,"userId"),balance:0,totalEarned:0};} function walletKey(t:string,u:string){return`${requireText(t,"tenantId")}:${requireText(u,"userId")}`;}
function boundedLimit(v:number){const n=Math.trunc(Number(v));if(!Number.isSafeInteger(n))throw new Error("limit is invalid");return Math.max(1,Math.min(100,n));} function boundedPercent(v:number,n:string){const x=Math.trunc(Number(v));if(!Number.isSafeInteger(x)||x<0||x>100)throw new Error(`${n} must be from 0 through 100`);return x;}
function positiveAmount(v:number){const n=Math.trunc(Number(v));if(!Number.isSafeInteger(n)||n<=0)throw new Error("amount must be a positive safe integer");return n;} function safeNonNegative(v:number,n:string){const x=Math.trunc(Number(v));if(!Number.isSafeInteger(x)||x<0)throw new Error(`${n} must be a non-negative safe integer`);return x;} function safeDelta(v:number,n:string){const x=Math.trunc(Number(v));if(!Number.isSafeInteger(x))throw new Error(`${n} must be a safe integer`);return x;}
function requireText(v:string,n:string){if(!v||v.trim()!==v||v.length>200||/[\r\n\0]/.test(v))throw new Error(`${n} is invalid`);return v;} function validTimestamp(v:string,n:string){if(!Number.isFinite(Date.parse(v)))throw new Error(`${n} must be an ISO timestamp`);return new Date(Date.parse(v)).toISOString();} function trimCompact(v:number){return v.toFixed(v>=100?0:v>=10?1:2).replace(/\.0+$|(?<=\.[0-9])0+$/,"");}
