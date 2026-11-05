import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import { parseNebulaMessage } from "./game-hub.js";
import type { NormalizedChatMessageV1 } from "@spmt/contracts";
import type { NebulaGameInputV1 } from "./game-inputs.js";

export class AsyncNebulaGameInputStore {
  private readonly records: AsyncJsonRecordStore;
  constructor(options: { databasePath?: string; mode?: "sqlite" | "turso"; url?: string; authToken?: string } = {}) {
    this.records = createAsyncJsonRecordStore({ service: "nebula-arcade", ...(options.databasePath?{databasePath:options.databasePath}:{}), ...(options.mode?{mode:options.mode}:{}), ...(options.url?{url:options.url}:{}), ...(options.authToken?{authToken:options.authToken}:{}) });
  }
  initialize(): Promise<void> { return this.records.initialize(); }
  health(): Promise<{ready:boolean}> { return this.records.health(); }
  close(): Promise<void>|void { return this.records.close(); }
  async append(message: NormalizedChatMessageV1, gameIds: string[], channelId = message.channelId) {
    if(message.actor.isBot || !parseNebulaMessage(message.text)?.body || !gameIds.length)return;
    const input: NebulaGameInputV1 = { id: `${message.provider}:${message.connectionId}:${message.messageId}`, channelId, providerChannelId:message.channelId, message:message.text, username:message.actor.displayName||message.actor.username, provider:message.provider, roles:message.actor.roles, gameIds, occurredAt:message.occurredAt };
    await this.records.transaction(async(tx)=>{
      const rows=await tx.list<{sequence:number;input:NebulaGameInputV1}>("game-inputs",message.tenantId);
      if(rows.some(row=>row.key===input.id))return;
      const sequence=rows.reduce((max,row)=>Math.max(max,row.value.sequence),0)+1;
      await tx.put("game-inputs",message.tenantId,input.id,{sequence,input});
      const channelRows=rows.filter(row=>row.value.input.channelId===channelId).sort((a,b)=>a.value.sequence-b.value.sequence);
      for(const stale of channelRows.slice(0,Math.max(0,channelRows.length+1-500)))await tx.delete("game-inputs",message.tenantId,stale.key);
    });
  }
  async list(tenantId:string,channelId?:string):Promise<NebulaGameInputV1[]> {
    const rows=await this.records.list<{sequence:number;input:NebulaGameInputV1}>("game-inputs",tenantId);
    return rows.map(row=>row.value).sort((a,b)=>a.sequence-b.sequence).filter(row=>!channelId||row.input.channelId===channelId).slice(-200).map(row=>row.input).filter(input=>parseNebulaMessage(input.message)?.body);
  }
}
