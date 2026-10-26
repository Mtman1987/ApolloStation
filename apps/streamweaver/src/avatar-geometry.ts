import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {promisify} from "node:util";
import {execFile} from "node:child_process";

export interface RiggedAvatarV1 {
  glb:Uint8Array;
  validation:{
    headBone:string;
    jawBone:string;
    eyeBones:string[];
    jawWeightedVertices:number;
    existingAnimationCount:number;
    blendshapeCount:number;
    createdArmature:boolean;
    skinPreserved:boolean;
  };
}
export interface StreamWeaverAvatarGeometryV1 { rig(existingGlb:Uint8Array):Promise<RiggedAvatarV1>; }

/** Run the direct GLB -> skeletal facial rig path. This never renders or reconstructs the head from photographs. */
export class BlenderAvatarGeometry implements StreamWeaverAvatarGeometryV1 {
  constructor(private readonly options:{binary:string;scriptPath:string;timeoutMs?:number}){}
  async rig(existingGlb:Uint8Array):Promise<RiggedAvatarV1>{
    if(!existingGlb.byteLength||existingGlb.byteLength>64*1024*1024)throw Error("Avatar GLB must be between 1 byte and 64 MiB");
    return this.workspace(async directory=>{
      const input=join(directory,"source.glb"),output=join(directory,"rigged.glb"),report=join(directory,"rigging.json");
      await writeFile(input,existingGlb);
      await this.run(["--background","--factory-startup","--python",resolve(this.options.scriptPath),"--","rig",input,output,report]);
      const validation=JSON.parse(await readFile(report,"utf8")) as RiggedAvatarV1["validation"];
      return{glb:new Uint8Array(await readFile(output)),validation};
    });
  }
  private async run(args:string[]){
    try{await promisify(execFile)(this.options.binary,args,{timeout:this.options.timeoutMs??10*60_000,maxBuffer:2*1024*1024});}
    catch(error){const value=error as Error&{stderr?:string};throw Error(`Direct avatar rigging failed: ${(value.stderr||value.message).replace(/[\\r\\n]+/g," ").slice(0,900)}`);}
  }
  private async workspace<T>(work:(directory:string)=>Promise<T>){const directory=await mkdtemp(join(tmpdir(),"streamweaver-avatar-rig-"));try{return await work(directory);}finally{await rm(directory,{recursive:true,force:true});}}
}
