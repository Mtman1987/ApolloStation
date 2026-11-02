import { chromium, type Browser, type BrowserContext } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DshNebulaGameplayCaptureRequestV1, DshNebulaGameplayRendererV1 } from "./nebula-gameplay.js";

const run=promisify(execFile);
const MAX_CAPTURE_FRAMES=600;
const MAX_OUTPUT_BYTES=50*1024*1024;

/** Captures the canonical Nebula Arcade showcase page; the manifest, not DSH, owns game identity. */
export class DshPlaywrightNebulaGameplayRenderer implements DshNebulaGameplayRendererV1 {
 constructor(private readonly options:{executablePath?:string;launchTimeoutMs?:number}={}){}
 async capture(request:DshNebulaGameplayCaptureRequestV1):Promise<Uint8Array>{
  const url=new URL(request.captureUrl);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new Error("Nebula gameplay capture URL must be credential-free HTTPS");
  const frameCount=request.captureSeconds*request.fps;
  if(!Number.isSafeInteger(frameCount)||frameCount<1||frameCount>MAX_CAPTURE_FRAMES||request.width!==960||request.height!==450||request.fps!==10||request.outputWidth!==480)throw new Error("Nebula gameplay capture dimensions or duration are invalid");
  const directory=await mkdtemp(join(tmpdir(),"dsh-nebula-gameplay-"));
  let browser:Browser|undefined,context:BrowserContext|undefined;
  try{
   browser=await chromium.launch({headless:true,...(this.options.executablePath?{executablePath:this.options.executablePath}:{}),timeout:this.options.launchTimeoutMs??30000,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-background-networking","--disable-default-apps"]});
   context=await browser.newContext({viewport:{width:request.width,height:request.height},deviceScaleFactor:1});
   await context.route("**/*",route=>{const raw=route.request().url();try{const target=new URL(raw);if(target.origin===url.origin||["data:","blob:","about:"].includes(target.protocol))return route.continue();}catch{}return route.abort("blockedbyclient");});
   const page=await context.newPage();
   await page.goto(url.toString(),{waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForTimeout(1200);
   for(let frame=0;frame<frameCount;frame++){
    const png=await page.screenshot({type:"png",animations:"allow",timeout:15000});
    await writeFile(join(directory,`frame-${String(frame).padStart(4,"0")}.png`),png);
    if(frame+1<frameCount)await page.waitForTimeout(1000/request.fps);
   }
   const palette=join(directory,"palette.png"),output=join(directory,"showcase.gif"),input=join(directory,"frame-%04d.png");
   const baseFilter=`fps=${request.fps},scale=${request.outputWidth}:-2:flags=lanczos`;
   await run("ffmpeg",["-y","-threads","1","-framerate",String(request.fps),"-i",input,"-vf",baseFilter+`,palettegen=max_colors=${request.palette.maxColors}:stats_mode=${request.palette.statsMode}`,palette],{timeout:120000,maxBuffer:4*1024*1024});
   await run("ffmpeg",["-y","-threads","1","-framerate",String(request.fps),"-i",input,"-i",palette,"-filter_complex_threads","1","-filter_complex",`[0:v]${baseFilter}[scaled];[scaled][1:v]paletteuse=dither=${request.palette.dither}:bayer_scale=${request.palette.bayerScale}:diff_mode=${request.palette.diffMode}`,"-loop","0",output],{timeout:120000,maxBuffer:4*1024*1024});
   const gif=await readFile(output);
   if(gif.length<6||gif.toString("ascii",0,6)!=="GIF89a"||gif.length>MAX_OUTPUT_BYTES)throw new Error("Nebula gameplay GIF is invalid or exceeds the 50 MB limit");
   return gif;
  }finally{
   await context?.close().catch(()=>undefined);await browser?.close().catch(()=>undefined);await rm(directory,{recursive:true,force:true});
  }
 }
}
