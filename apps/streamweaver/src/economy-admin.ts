import type { StreamWeaverEconomyStoreV1, StreamWeaverCurrencyWalletV1 } from "./economy.js";

export interface StreamWeaverTenantMemberSourceV1 {
  listCanonicalUserIds(tenantId: string): Promise<string[]> | string[];
}

/** StreamWeaver moderator operations mutate only the tenant-owned local currency. */
export class StreamWeaverAdminEconomy {
  constructor(private readonly store: StreamWeaverEconomyStoreV1, private readonly tenantId: string, private readonly members: StreamWeaverTenantMemberSourceV1) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async addPoints(userId: string, deltaInput: number, operationId: string, metadata: Record<string, unknown> = {}) {
    return this.adjust([userId],"add",deltaInput,operationId,metadata,false).wallets[0]!;
  }

  async setPoints(userId: string, targetInput: number, operationId: string, metadata: Record<string, unknown> = {}) {
    return this.adjust([userId],"set",targetInput,operationId,metadata,false).wallets[0]!;
  }

  async addToAll(delta: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const users = await this.uniqueMembers();
    return this.adjust(users,"add",delta,operationId,metadata,true).wallets.length;
  }

  async setToAll(target: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const users = await this.uniqueMembers();
    return this.adjust(users,"set",target,operationId,metadata,true).wallets.length;
  }

  resetAll(operationId: string, metadata: Record<string, unknown> = {}) {
    return this.setToAll(0, operationId, { ...metadata, command: "!resetallpoints" });
  }

  private async uniqueMembers() {
    const users = await this.members.listCanonicalUserIds(this.tenantId);
    return [...new Set(users.map((value) => String(value).trim()).filter(Boolean))].sort();
  }

  private adjust(users:string[],mode:"add"|"set",input:number,operationId:string,metadata:Record<string,unknown>,bulk:boolean) {
    const amount=mode==="set"?Math.max(0,safeInteger(input,"amount")):safeInteger(input,"amount"),actorId=String(metadata.moderatorUserId??metadata.actorId??""),key=`admin:${operationId}`;
    if(!operationId||operationId.length>250||users.length>10000)throw new Error("Currency operation is invalid or exceeds 10,000 wallets");
    const signature=JSON.stringify([mode,amount,actorId,bulk?"all":users]);
    return this.store.transaction(()=>{
      const prior=this.store.getReceipt(this.tenantId,key);
      if(prior){if(prior.kind!=="admin"||prior.result.signature!==signature)throw new Error("Currency operation ID was already used with different values");return {wallets:prior.result.wallets as StreamWeaverCurrencyWalletV1[]};}
      const wallets=users.map(userId=>mode==="set"?this.store.setBalance(this.tenantId,userId,amount):this.store.adjustBalance(this.tenantId,userId,amount,amount>0));
      this.store.putReceipt(this.tenantId,{operationId:key,kind:"admin",result:{signature,wallets},createdAt:new Date().toISOString()});
      return {wallets};
    },{reason:`${bulk?"bulk":"admin"}-${mode}`,operationId,actorId});
  }
}

function safeInteger(value: number, name: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 1_000_000_000_000) throw new Error(`${name} must be a safe integer in the supported local-currency range`);
  return parsed;
}
