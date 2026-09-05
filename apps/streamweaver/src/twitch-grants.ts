import { SpmtApiError, type SpmtClient } from "@spmt/sdk";
import type { StreamWeaverTwitchGrantSourceV1, StreamWeaverTwitchGrantResultV1 } from "./twitch-command-adapter.js";

/** OAuth scopes belong to the shared grant authority. This map never supplies refresh tokens. */
export const STREAMWEAVER_TWITCH_COMMAND_SCOPES:Readonly<Record<string,readonly string[]>>=Object.freeze({
  "clips:write":["clips:edit"],"followers:read":["moderator:read:followers"],"streams:read":[],
  "channel:manage":["channel:manage:broadcast"],"shoutouts:manage":["moderator:manage:shoutouts"],"users:read":[],
});
export class SpmtStreamWeaverTwitchGrantSource implements StreamWeaverTwitchGrantSourceV1 {
  constructor(private readonly broker:Pick<SpmtClient,"issueProviderGrant">,private readonly broadcaster:(tenantId:string)=>string|undefined,private readonly allowWrites:boolean){}
  async getGrant(input:{tenantId:string;capability:string}):Promise<StreamWeaverTwitchGrantResultV1>{
    const scopes=Object.hasOwn(STREAMWEAVER_TWITCH_COMMAND_SCOPES,input.capability)?STREAMWEAVER_TWITCH_COMMAND_SCOPES[input.capability]:undefined;
    if(!scopes)return {status:"unavailable",reason:"This Twitch command capability is not registered."};
    if(!this.allowWrites&&["clips:write","channel:manage","shoutouts:manage"].includes(input.capability))return {status:"unavailable",reason:"This environment captures provider output and does not allow live Twitch changes."};
    const broadcasterId=this.broadcaster(input.tenantId);
    if(!broadcasterId)return {status:"unavailable",reason:"Choose your linked Twitch broadcaster in StreamWeaver Integrations."};
    try{
      const grant=await this.broker.issueProviderGrant(input.tenantId,"twitch",broadcasterId,input.capability,[...scopes],300);
      const clientId=grant.credential.metadata.clientId??grant.credential.metadata.client_id;
      if(!clientId)return {status:"unavailable",reason:"The shared Twitch grant is missing its client identity."};
      return {status:"ready",clientId,accessToken:grant.credential.accessToken,broadcasterId,moderatorId:broadcasterId,expiresAt:grant.expiresAt};
    }catch(error){
      if(error instanceof SpmtApiError&&error.status===403)return {status:"reauthorization-required",reason:`Authorize ${input.capability} for this broadcaster through SPMT Account.`};
      if(error instanceof SpmtApiError&&error.status===503)return {status:"unavailable",reason:"SPMT could not issue a current Twitch grant."};
      throw error;
    }
  }
}
