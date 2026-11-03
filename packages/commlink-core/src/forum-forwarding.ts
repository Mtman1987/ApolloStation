import {DatabaseSync} from "node:sqlite";

export type CommlinkForumForwardRuleV1={schemaVersion:1;tenantId:string;sourceGuildId:string;destinationGuildId:string;forumChannelId:string;mode:"per-channel"|"single-thread";sharedThreadId?:string;paused:boolean;restrictToWhitelist:boolean;sourceChannelWhitelist:string[];};
function snowflake(value:unknown,name:string){const v=String(value??"");if(v.length<5||v.length>30||Array.from(v).some(c=>c<"0"||c>"9"))throw Error("Invalid forum forwarding "+name);return v;}
export function validateCommlinkForumForwardRule(value:CommlinkForumForwardRuleV1):CommlinkForumForwardRuleV1{
 if(!value||value.schemaVersion!==1||typeof value.paused!=="boolean"||typeof value.restrictToWhitelist!=="boolean"||!Array.isArray(value.sourceChannelWhitelist)||value.sourceChannelWhitelist.length>500)throw Error("Invalid forum forwarding rule");
 const sourceGuildId=snowflake(value.sourceGuildId,"source guild"),destinationGuildId=snowflake(value.destinationGuildId,"destination guild"),forumChannelId=snowflake(value.mode==="single-thread"?value.sharedThreadId:value.forumChannelId,value.mode==="single-thread"?"shared thread":"forum channel");
 if(value.mode!=="per-channel"&&value.mode!=="single-thread")throw Error("Invalid forum forwarding mode");
 const sourceChannelWhitelist=[...new Set(value.sourceChannelWhitelist.map(v=>snowflake(v,"source channel")))];
 return {...value,sourceGuildId,destinationGuildId,forumChannelId,...(value.mode==="single-thread"?{sharedThreadId:forumChannelId}:{}),sourceChannelWhitelist};
}
export class CommlinkForumForwardingStore{
 private readonly db:DatabaseSync;
 constructor(path:string){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS commlink_forum_forward_rules(tenant TEXT NOT NULL,source_guild TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tenant,source_guild)) STRICT;");}
 close(){this.db.close();}
 putRule(input:CommlinkForumForwardRuleV1){const rule=validateCommlinkForumForwardRule(input);if(!rule.tenantId||rule.tenantId.length>160)throw Error("Invalid tenant ID");const now=new Date().toISOString();this.db.prepare("INSERT INTO commlink_forum_forward_rules VALUES(?,?,?,?,1) ON CONFLICT(tenant,source_guild) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,revision=commlink_forum_forward_rules.revision+1").run(rule.tenantId,rule.sourceGuildId,JSON.stringify(rule),now);return this.getRule(rule.tenantId,rule.sourceGuildId)!;}
 getRule(tenantId:string,sourceGuildId:string){const row=this.db.prepare("SELECT body FROM commlink_forum_forward_rules WHERE tenant=? AND source_guild=?").get(tenantId,snowflake(sourceGuildId,"source guild")) as {body:string}|undefined;return row?validateCommlinkForumForwardRule(JSON.parse(row.body) as CommlinkForumForwardRuleV1):undefined;}
 listRules(tenantId:string){const rows=this.db.prepare("SELECT body FROM commlink_forum_forward_rules WHERE tenant=? ORDER BY source_guild").all(tenantId) as Array<{body:string}>;return rows.map(row=>validateCommlinkForumForwardRule(JSON.parse(row.body) as CommlinkForumForwardRuleV1));}
 deleteRule(tenantId:string,sourceGuildId:string){return Number(this.db.prepare("DELETE FROM commlink_forum_forward_rules WHERE tenant=? AND source_guild=?").run(tenantId,snowflake(sourceGuildId,"source guild")).changes)>0;}
 replaceRules(tenantId:string,rules:CommlinkForumForwardRuleV1[]){this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("DELETE FROM commlink_forum_forward_rules WHERE tenant=?").run(tenantId);for(const rule of rules)this.putRule({...rule,tenantId});this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
