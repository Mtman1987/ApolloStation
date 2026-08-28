import type { AppSettingsDefinitionV1, AppSettingsDocumentV1, AppSettingsPatchV1, AssistantMemoryPolicyV1 } from "@spmt/contracts";
import { AppSettingsService, SqliteAppPrivateDatabase, type AppPrivateDatasetManifestV1 } from "@spmt/app-foundation";
import type { StreamWeaverPersonaConfigSourceV1, StreamWeaverPersonaConfigV1 } from "./chat-gateway-consumer.js";

export const STREAMWEAVER_PERSONA_SETTINGS_V1:AppSettingsDefinitionV1 = {
  schemaVersion: 1,
  appId: "streamweaver",
  settingsVersion: 1,
  subject: "tenant",
  fields: [
    { key: "personaId", label: "Persona ID", description: "Stable internal ID for this tenant-owned presentation.", type: "string", sensitive: false, required: true, defaultValue: "persona-default" },
    { key: "displayName", label: "Display name", description: "Public chat name for this tenant's persona.", type: "string", sensitive: false, required: true, defaultValue: "Assistant" },
    { key: "aliases", label: "Aliases", description: "Comma or newline separated names that address this persona.", type: "string", sensitive: false, required: true, defaultValue: "assistant" },
    { key: "ownerCanonicalUserId", label: "Owner", description: "Canonical SPMT user allowed to summon this persona casually.", type: "string", sensitive: false, required: true },
    { key: "homeChannelIds", label: "Home channels", description: "Comma or newline separated provider channel IDs where mentions work without an external summon.", type: "string", sensitive: false, defaultValue: "" },
    { key: "summonWindowMinutes", label: "External summon window", description: "How long the owner's external-channel summon remains active.", type: "number", sensitive: false, required: true, defaultValue: 10, minimum: 1, maximum: 120 },
    { key: "instructions", label: "Persona instructions", description: "Tenant-owned behavior and voice instructions executed by persona-neutral Stellar Core.", type: "string", sensitive: false, required: true, defaultValue: "Be accurate, helpful, concise, and faithful to the configured presentation." },
    { key: "memoryPolicy", label: "Memory policy", description: "Off loads no remembered context; Conversation loads only this user and persona conversation.", type: "enum", sensitive: false, required: true, defaultValue: "conversation", options: [{ value: "off", label: "Off" }, { value: "conversation", label: "Conversation" }] },
  ],
};

export const STREAMWEAVER_PERSONA_DATASET_V1:AppPrivateDatasetManifestV1={schemaVersion:1,appId:"streamweaver",dataset:"persona-settings",classification:"private-authority",owner:"streamweaver",retention:"Until the tenant deletes StreamWeaver or explicitly replaces its persona settings.",maximumBytes:16*1024*1024,recovery:"Checkpoint with the StreamWeaver private database and verify settings revision after restore."};

export interface StreamWeaverLegacyPersonaV1 extends StreamWeaverPersonaConfigV1 {}
export interface StreamWeaverLegacyPersonaImportV1 { tenantId:string; status:"imported"|"already-configured"; revision:number; }

export class StreamWeaverPersonaSettingsStore implements StreamWeaverPersonaConfigSourceV1 {
  private readonly database:SqliteAppPrivateDatabase;
  private readonly settings:AppSettingsService;
  constructor(path:string,now:()=>string=()=>new Date().toISOString()){
    this.database=new SqliteAppPrivateDatabase(path,STREAMWEAVER_PERSONA_DATASET_V1,[],now);
    this.settings=new AppSettingsService(STREAMWEAVER_PERSONA_SETTINGS_V1,this.database,undefined,now);
  }
  close(){this.database.close();}
  checkpoint(){return this.database.checkpoint();}
  read(tenantId:string):AppSettingsDocumentV1{return this.settings.read(tenantId,tenantId);}
  patch(tenantId:string,patch:AppSettingsPatchV1):AppSettingsDocumentV1{return this.settings.patch(tenantId,tenantId,patch);}
  get(tenantId:string):StreamWeaverPersonaConfigV1|undefined{
    const document=this.read(tenantId), values=document.values;
    if(typeof values.ownerCanonicalUserId!=="string"||!values.ownerCanonicalUserId)return undefined;
    const memoryPolicy=values.memoryPolicy;
    if(memoryPolicy!=="off"&&memoryPolicy!=="conversation")throw new Error("StreamWeaver persona memory policy is invalid");
    return{schemaVersion:1,tenantId,personaId:value(values.personaId,"personaId"),displayName:label(values.displayName,"displayName"),aliases:list(values.aliases,"aliases"),ownerCanonicalUserId:value(values.ownerCanonicalUserId,"ownerCanonicalUserId"),homeChannelIds:optionalList(values.homeChannelIds,"homeChannelIds"),summonWindowMs:minutes(values.summonWindowMinutes)*60*1000,instructions:instructions(values.instructions),memoryPolicy:memoryPolicy as AssistantMemoryPolicyV1};
  }
  importLegacy(records:StreamWeaverLegacyPersonaV1[]):StreamWeaverLegacyPersonaImportV1[]{
    const seen=new Set<string>(),results:StreamWeaverLegacyPersonaImportV1[]=[];
    for(const record of records){
      const normalized=legacyRecord(record);
      if(seen.has(normalized.tenantId))throw new Error(`Legacy StreamWeaver persona input repeats tenant ${normalized.tenantId}`);seen.add(normalized.tenantId);
      const current=this.read(normalized.tenantId);
      if(current.revision>0){results.push({tenantId:normalized.tenantId,status:"already-configured",revision:current.revision});continue;}
      const next=this.patch(normalized.tenantId,{schemaVersion:1,expectedRevision:0,values:normalized.values});
      results.push({tenantId:normalized.tenantId,status:"imported",revision:next.revision});
    }
    return results;
  }
}

function value(input:unknown,name:string){if(typeof input!=="string"||!/^[A-Za-z0-9._:@/-]{1,200}$/.test(input))throw new Error(`StreamWeaver ${name} is invalid`);return input;}
function label(input:unknown,name:string){if(typeof input!=="string"||!input.trim()||input.length>120||/[\r\n]/.test(input))throw new Error(`StreamWeaver ${name} is invalid`);return input.trim();}
function instructions(input:unknown){if(typeof input!=="string"||!input.trim()||input.length>4000)throw new Error("StreamWeaver persona instructions are invalid");return input.trim();}
function optionalList(input:unknown,name:string){if(input===""||input===undefined)return[];return list(input,name);}
function list(input:unknown,name:string){if(typeof input!=="string")throw new Error(`StreamWeaver ${name} is invalid`);const result=[...new Set(input.split(/[\n,]/).map((item)=>item.trim().toLowerCase()).filter(Boolean))];if(!result.length||result.length>50||result.some((item)=>!/^[A-Za-z0-9._:@/-]{1,200}$/.test(item)))throw new Error(`StreamWeaver ${name} is invalid`);return result;}
function minutes(input:unknown){if(typeof input!=="number"||!Number.isSafeInteger(input)||input<1||input>120)throw new Error("StreamWeaver summon window is invalid");return input;}
function legacyRecord(record:StreamWeaverLegacyPersonaV1){const tenantId=value(record.tenantId,"tenantId"),personaId=value(record.personaId,"personaId"),displayName=label(record.displayName,"displayName"),aliases=list(record.aliases.join("\n"),"aliases"),ownerCanonicalUserId=value(record.ownerCanonicalUserId,"ownerCanonicalUserId"),homeChannelIds=record.homeChannelIds.length?list(record.homeChannelIds.join("\n"),"homeChannelIds"):[],summonWindowMinutes=minutes(record.summonWindowMs/60000),personaInstructions=instructions(record.instructions);if(record.memoryPolicy!=="off"&&record.memoryPolicy!=="conversation")throw new Error("StreamWeaver persona memory policy is invalid");return{tenantId,values:{personaId,displayName,aliases:aliases.join("\n"),ownerCanonicalUserId,homeChannelIds:homeChannelIds.join("\n"),summonWindowMinutes,instructions:personaInstructions,memoryPolicy:record.memoryPolicy}};}
