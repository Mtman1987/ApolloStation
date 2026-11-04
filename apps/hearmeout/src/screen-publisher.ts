/** Uploads only the stream explicitly selected by getDisplayMedia, never the mic. */
export class HearMeOutScreenPublisher {
 private recorder:MediaRecorder|null=null;
 private endpoint='';
 private stopped=false;
 private pending=0;
 private tail=Promise.resolve();
 private sequence=0;
 constructor(private onFailure:(message:string)=>void){}
 async start(roomId:string,stream:MediaStream){
  const mimeType=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  if(!mimeType)throw Error('Screen broadcasting is unavailable in this browser. Try Chrome or Edge on a computer.');
  const endpoint='/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/screen';
  const accepted=await this.request(endpoint,{method:'POST'});
  this.endpoint=endpoint+'/'+accepted.id;
  if(this.stopped){void this.stopRemote();throw Error('Screen sharing was cancelled');}
  try{
   this.recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2000000,audioBitsPerSecond:128000});
   this.recorder.ondataavailable=event=>{
    if(this.stopped||!event.data.size)return;
    this.pending+=event.data.size;
    if(this.pending>8*1024*1024){this.fail('Screen upload cannot keep up. Share a smaller window or try again.');return;}
    const sequence=this.sequence++,data=event.data;
    this.tail=this.tail.then(async()=>{
     if(this.stopped)return;
     const url=this.endpoint+'?sequence='+sequence;
     try{await this.request(url,{method:'POST',headers:{'content-type':'video/webm'},body:data})}
     catch(error){if(this.stopped)return;await this.request(url,{method:'POST',headers:{'content-type':'video/webm'},body:data})}
    }).catch(error=>this.fail(error instanceof Error?error.message:String(error))).finally(()=>{this.pending-=data.size});
   };
   this.recorder.onerror=()=>this.fail('Screen recording failed. Please share again.');
   this.recorder.start(1000);
   return accepted.roomId as string;
  }catch(error){this.stop();throw error}
 }
 private async request(url:string,init:RequestInit){const response=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||data.message||'Screen sharing connection failed');return data}
 private fail(message:string){if(this.stopped)return;this.stop();this.onFailure(message)}
 private async stopRemote(){if(this.endpoint)await fetch(this.endpoint,{method:'DELETE',keepalive:true}).catch(()=>{})}
 stop(){if(this.stopped)return;this.stopped=true;if(this.recorder?.state==='recording')this.recorder.stop();void this.stopRemote()}
}
