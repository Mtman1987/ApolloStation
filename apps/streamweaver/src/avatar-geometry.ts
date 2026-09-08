import {execFile} from "node:child_process";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {promisify} from "node:util";
import type {KeenToolsAvatarViewV1} from "./keentools-avatar-provider.js";

export interface PreparedMeshyHeadV1 { hairGlb:Uint8Array;views:KeenToolsAvatarViewV1[];alignment:Record<string,unknown>; }
export interface AssembledAvatarV1 { glb:Uint8Array;validation:{headBone:string;hairBones:string[];blendshapeCount:number;bodySkinPreserved:boolean}; }
export interface StreamWeaverAvatarGeometryV1 { prepare(meshyGlb:Uint8Array):Promise<PreparedMeshyHeadV1>;assemble(input:{bodyGlb:Uint8Array;keenHeadGlb:Uint8Array;hairGlb:Uint8Array;alignment:Record<string,unknown>}):Promise<AssembledAvatarV1>; }

export class BlenderAvatarGeometry implements StreamWeaverAvatarGeometryV1 {
  constructor(private readonly options:{binary:string;scriptPath:string;timeoutMs?:number}){}
  async prepare(meshyGlb:Uint8Array){return this.workspace(async directory=>{
    const input=join(directory,"meshy.glb"),hair=join(directory,"hair.glb"),views=join(directory,"views"),report=join(directory,"alignment.json");
    await writeFile(input,meshyGlb);await this.run(["--background","--factory-startup","--python",resolve(this.options.scriptPath),"--","prepare",input,hair,views,report]);
    const alignment=JSON.parse(await readFile(report,"utf8")) as Record<string,unknown>,hairGlb=new Uint8Array(await readFile(hair)),photos:KeenToolsAvatarViewV1[]=[];
    for(let index=0;index<10;index++)photos.push({bytes:new Uint8Array(await readFile(join(views,`view-${String(index).padStart(2,"0")}.png`))),contentType:"image/png"});
    return{hairGlb,views:photos,alignment};
  });}
  async assemble(input:{bodyGlb:Uint8Array;keenHeadGlb:Uint8Array;hairGlb:Uint8Array;alignment:Record<string,unknown>}){return this.workspace(async directory=>{
    const body=join(directory,"body.glb"),head=join(directory,"keen-head.glb"),hair=join(directory,"hair.glb"),alignment=join(directory,"alignment.json"),output=join(directory,"avatar.glb"),report=join(directory,"validation.json");
    await Promise.all([writeFile(body,input.bodyGlb),writeFile(head,input.keenHeadGlb),writeFile(hair,input.hairGlb),writeFile(alignment,JSON.stringify(input.alignment))]);
    await this.run(["--background","--factory-startup","--python",resolve(this.options.scriptPath),"--","assemble",body,head,hair,alignment,output,report]);
    return{glb:new Uint8Array(await readFile(output)),validation:JSON.parse(await readFile(report,"utf8")) as AssembledAvatarV1["validation"]};
  });}
  private async run(args:string[]){try{await promisify(execFile)(this.options.binary,args,{timeout:this.options.timeoutMs??10*60_000,maxBuffer:2*1024*1024});}catch(error){const value=error as Error&{stderr?:string};throw Error(`Avatar geometry failed: ${(value.stderr||value.message).replace(/[\r\n]+/g," ").slice(0,900)}`);}}
  private async workspace<T>(work:(directory:string)=>Promise<T>){const directory=await mkdtemp(join(tmpdir(),"streamweaver-avatar-"));try{return await work(directory);}finally{await rm(directory,{recursive:true,force:true});}}
}
