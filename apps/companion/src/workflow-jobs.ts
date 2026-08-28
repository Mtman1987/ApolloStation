import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export const COMPANION_WORKFLOWS = {
  "test.echo": { title: "Harmless relay test", description: "Returns bounded text without touching files, OBS, audio, or external processes.", requiresConfirmation: false },
  "audio.jingle.play": { title: "Play approved local jingle", description: "Restarts a named OBS media input with an existing file from the Companion library.", requiresConfirmation: true },
  "song.render.request": { title: "Approve a creative render brief", description: "Stores a reviewed engine-neutral song brief for manual or future allowlisted rendering.", requiresConfirmation: true },
} as const;
export type CompanionWorkflowIdV1 = keyof typeof COMPANION_WORKFLOWS;
export type CompanionWorkflowStatusV1 = "awaiting_review" | "approved" | "running" | "waiting_for_renderer" | "completed" | "rejected" | "failed";

export interface CompanionWorkflowJobV1 {
  id: string;
  workflowId: CompanionWorkflowIdV1;
  title: string;
  source: string;
  payload: Record<string, unknown>;
  status: CompanionWorkflowStatusV1;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewSource?: string;
  startedAt?: string;
  completedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface CompanionWorkflowStoreV1 { list(): CompanionWorkflowJobV1[]; put(job: CompanionWorkflowJobV1): void; }
export class MemoryCompanionWorkflowStore implements CompanionWorkflowStoreV1 {
  private readonly jobs = new Map<string, CompanionWorkflowJobV1>();
  list(): CompanionWorkflowJobV1[] { return [...this.jobs.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-200).map((job)=>structuredClone(job)); }
  put(job: CompanionWorkflowJobV1) { this.jobs.set(job.id, structuredClone(job)); }
}
export interface CompanionMediaLibraryV1 { has(name:string):boolean; writeJson(name:string,value:Record<string,unknown>):void; }
export interface CompanionWorkflowExecutorV1 { playObsMedia(input:{mediaName:string;obsInputName:string;title:string}):Promise<Record<string,unknown>>; }

export class CompanionWorkflowJobs {
  constructor(private readonly store: CompanionWorkflowStoreV1, private readonly media: CompanionMediaLibraryV1, private readonly executor: CompanionWorkflowExecutorV1, private readonly options: { now?:()=>string; idFactory?:()=>string; onUpdate?:(job:CompanionWorkflowJobV1)=>void } = {}) {}
  catalog(){return Object.entries(COMPANION_WORKFLOWS).map(([id,definition])=>({id,...definition}));}
  snapshot(){const jobs=this.store.list();for(const job of jobs){if(job.status!=="waiting_for_renderer")continue;const outputName=String(job.payload.outputName??"");if(!outputName||!this.media.has(outputName))continue;this.update(job,{status:"completed",completedAt:this.now(),result:{...(job.result??{}),outputName,rendered:true}});}return this.store.list();}
  createReviewRequest(workflowId:CompanionWorkflowIdV1,payload:unknown,source="local"){
    const definition=COMPANION_WORKFLOWS[workflowId];if(!definition)throw new Error("Workflow is not allowlisted");const now=this.now();const job:CompanionWorkflowJobV1={id:this.options.idFactory?.()??randomUUID(),workflowId,title:definition.title,source:text(source,80)||"local",payload:validateCompanionWorkflowPayload(workflowId,payload),status:definition.requiresConfirmation?"awaiting_review":"approved",createdAt:now,updatedAt:now};this.store.put(job);this.options.onUpdate?.(structuredClone(job));return structuredClone(job);
  }
  async review(jobId:string,approved:boolean){const job=this.require(jobId);if(job.status!=="awaiting_review")throw new Error("Workflow job is not awaiting review");if(!approved)return this.update(job,{status:"rejected",completedAt:this.now()});this.update(job,{status:"approved",reviewedAt:this.now()});return this.executeExisting(job);}
  async run(workflowId:CompanionWorkflowIdV1,payload:unknown,source="relay"){const created=this.createReviewRequest(workflowId,payload,source);if(created.status==="awaiting_review")return created;return this.executeExisting(this.require(created.id));}
  async runApproved(workflowId:CompanionWorkflowIdV1,payload:unknown,source="relay"){const created=this.createReviewRequest(workflowId,payload,source);const job=this.require(created.id);if(job.status==="awaiting_review")this.update(job,{status:"approved",reviewedAt:this.now(),reviewSource:"relay-confirmation"});return this.executeExisting(job);}
  private async executeExisting(job:CompanionWorkflowJobV1){this.update(job,{status:"running",startedAt:this.now()});try{let result:Record<string,unknown>;let status:CompanionWorkflowStatusV1="completed";if(job.workflowId==="test.echo"){result={echoed:String(job.payload.message??""),touchedLocalState:false};}else if(job.workflowId==="audio.jingle.play"){const mediaName=String(job.payload.mediaName);if(!this.media.has(mediaName))throw new Error("The approved jingle is not in the local media library");result=await this.executor.playObsMedia({mediaName,obsInputName:String(job.payload.obsInputName),title:String(job.payload.title)});}else{status="waiting_for_renderer";const manifestName=`creative-job-${job.id}.json`;this.media.writeJson(manifestName,{schemaVersion:1,jobId:job.id,workflowId:job.workflowId,title:job.payload.title,engine:job.payload.engine,voice:job.payload.voice,language:job.payload.language,genre:job.payload.genre,brief:job.payload.brief,lyrics:job.payload.lyrics,projectFile:job.payload.projectFile||null,outputName:job.payload.outputName,approvedAt:job.reviewedAt??this.now()});result={readyForRender:true,renderer:job.payload.engine,projectFile:job.payload.projectFile||null,outputName:job.payload.outputName,manifestName,note:"A reviewed manifest was written to the approved media library. No arbitrary command was executed."};}return this.update(job,{status,result,...(status==="completed"?{completedAt:this.now()}:{})});}catch(error){this.update(job,{status:"failed",error:error instanceof Error?error.message:"Workflow failed",completedAt:this.now()});throw error;}}
  private require(id:string){const job=this.store.list().find((entry)=>entry.id===id);if(!job)throw new Error("Workflow job was not found");return job;}
  private update(job:CompanionWorkflowJobV1,patch:Partial<CompanionWorkflowJobV1>){const next={...job,...structuredClone(patch),updatedAt:this.now()};Object.assign(job,next);this.store.put(next);this.options.onUpdate?.(structuredClone(next));return structuredClone(next);}
  private now(){const value=this.options.now?.()??new Date().toISOString();if(!Number.isFinite(Date.parse(value)))throw new Error("Companion workflow clock is invalid");return new Date(value).toISOString();}
}

export function validateCompanionWorkflowPayload(workflowId:CompanionWorkflowIdV1,value:unknown):Record<string,unknown>{const payload=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};if(workflowId==="test.echo")return{message:text(payload.message??"Companion workflow test passed",200)};if(workflowId==="audio.jingle.play"){const mediaName=safeName(payload.mediaName);const obsInputName=text(payload.obsInputName,120);if(!mediaName||!obsInputName)throw new Error("mediaName and obsInputName are required");return{mediaName,obsInputName,title:text(payload.title??mediaName,120)};}if(workflowId==="song.render.request"){const title=text(payload.title,120);const brief=text(payload.brief,4000);if(!title||!brief)throw new Error("title and brief are required");return{title,brief,engine:text(payload.engine??"unassigned",80),voice:text(payload.voice,80),language:text(payload.language,40),genre:text(payload.genre,80),lyrics:text(payload.lyrics,12000),projectFile:safeName(payload.projectFile),outputName:safeName(payload.outputName??`${title}.wav`)};}throw new Error("Workflow is not allowlisted");}
function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function safeName(value:unknown){return basename(text(value,240)).replace(/[^a-z0-9 ._()[\]-]+/gi,"-");}
